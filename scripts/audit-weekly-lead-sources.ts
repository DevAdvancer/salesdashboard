/** Read-only verification: no schema changes, CRM writes, or invitation imports. */
import dotenv from 'dotenv';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client, Databases, Query } from 'node-appwrite';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { loadWeeklyLeadSourceFacts, summarizeWeeklyLeadSources } = await import('../lib/server/weekly-lead-source-report');
  const { listAllDocuments } = await import('../lib/server/appwrite-pagination');
  const { getCurrentEasternIsoDate } = await import('../lib/utils/eastern-date');
  const startDate = process.argv.find(arg => arg.startsWith('--from='))?.slice(7) ?? '2026-07-01';
  const endDate = process.argv.find(arg => arg.startsWith('--to='))?.slice(5) ?? getCurrentEasternIsoDate();
  const databases = new Databases(new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!));
  type AuditUser = { $id: string; name: string; department?: string; isActive?: boolean; role: string; teamLeadId?: string };
  const users = await listAllDocuments<AuditUser>({
    databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
    queries: [Query.select(['$id', 'name', 'department', 'isActive', 'role', 'teamLeadId']), Query.orderAsc('$id')],
  });
  const salesUsers = new Map(users.filter(user => (user.department ?? 'sales') === 'sales').map(user => [user.$id, user]));
  const facts = await loadWeeklyLeadSourceFacts({ databases: databases as never, startDate, endDate });
  const summary = summarizeWeeklyLeadSources(facts, new Set(salesUsers.keys()));
  const agents = [...summary].map(([id, values]) => ({ agent: salesUsers.get(id)!.name, ...values }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
  const total = (ids: Set<string>) => [...summarizeWeeklyLeadSources(facts, ids).values()].reduce((sum, values) => ({
    linkedinLeads: sum.linkedinLeads + values.linkedinLeads,
    linkedinNotInterested: sum.linkedinNotInterested + values.linkedinNotInterested,
    notInterested: sum.notInterested + values.notInterested,
  }), { linkedinLeads: 0, linkedinNotInterested: 0, notInterested: 0 });
  const visible = users.filter(user => (user.department ?? 'sales') === 'sales' && (user.isActive ?? true) &&
    ['agent', 'team_lead', 'lead_generation'].includes(user.role));
  const output = { mode: 'READ ONLY', startDate, endDate, verifiedAt: new Date().toISOString(),
    allSalesTotals: total(new Set(salesUsers.keys())),
    activeWeeklyReportUsers: total(new Set(visible.map(user => user.$id))), agents,
    definitions: { linkedinLeads: 'LinkedIn-source leads created in range, including later Not Interested leads',
      linkedinNotInterested: 'Active Not Interested outcomes marked in range, including legacy closedAt fallback' },
    writes: 0 };
  const directory = path.resolve('outputs/weekly-source-report-verification');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${startDate}_${endDate}.json`);
  writeFileSync(file, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, agents: `${agents.length} agents; see output file`, file }, null, 2));
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
