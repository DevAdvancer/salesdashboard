/** Keep the first request per company/profile while preserving the current state. */
import { Client, Databases, Query } from 'node-appwrite';
import dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planLinkedinRequestCleanup, type LinkedinRequestCleanupRow } from '../lib/utils/linkedin-request-cleanup';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const requestsCollection = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID || 'linkedin_requests';
const leadsCollection = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
if (!projectId || !apiKey) throw new Error('Appwrite project ID and API key are required.');
const apply = process.argv.includes('--apply');
const expectedPreview = process.argv.find(argument => argument.startsWith('--preview='))?.slice('--preview='.length);

const databases = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
type RequestRow = LinkedinRequestCleanupRow;

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: number }).code;
      const transient = error instanceof Error &&
        (error.message === 'fetch failed' || error.name === 'TypeError');
      if (attempt >= 4 || !(code === 429 || (code && code >= 500) || transient)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

async function listRequests(): Promise<RequestRow[]> {
  const rows: RequestRow[] = [];
  let cursor: string | null = null;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await retry(() => databases.listDocuments(databaseId, requestsCollection, queries));
    rows.push(...page.documents as unknown as RequestRow[]);
    if (page.documents.length < 100) return rows;
    cursor = page.documents[page.documents.length - 1].$id;
  }
}

async function findLeadReferences(requestIds: Set<string>) {
  const references = new Map<string, string[]>();
  let cursor: string | null = null;
  let scanned = 0;
  let invalidJson = 0;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.select(['$id', 'data']), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await retry(() => databases.listDocuments(databaseId, leadsCollection, queries));
    for (const lead of page.documents) {
      scanned += 1;
      try {
        const data = JSON.parse((lead as { data: string }).data) as { linkedinRequestId?: unknown };
        if (typeof data.linkedinRequestId === 'string' && requestIds.has(data.linkedinRequestId)) {
          references.set(data.linkedinRequestId,
            [...(references.get(data.linkedinRequestId) || []), lead.$id]);
        }
      } catch { invalidJson += 1; }
    }
    if (page.documents.length < 100) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return { scanned, invalidJson, references: Object.fromEntries(references) };
}

async function main() {
  const rows = await listRequests();
  const initial = planLinkedinRequestCleanup(rows);
  const leadReferences = await findLeadReferences(new Set(initial.duplicates.flatMap(group =>
    [group.keeper.$id, ...group.remove.map(row => row.$id)])));
  const { duplicates, invalid, crossCompanyProfiles } =
    planLinkedinRequestCleanup(rows, leadReferences.references);
  const preview = createHash('sha256').update(JSON.stringify({
    duplicates: duplicates.map(group => ({ key: group.key,
      rows: [group.keeper, ...group.remove].map(row => [row.$id, row.$updatedAt]),
      keeperAfter: group.keeperAfter, leadRewrites: group.leadRewrites })),
    leadReferences: leadReferences.references,
  })).digest('hex');
  const count = (filter: (row: RequestRow) => boolean) => duplicates.filter(group =>
    [group.keeper, ...group.remove].some(filter)).length;
  const reportPath = path.join(tmpdir(), 'crm-linkedin-duplicate-cleanup-preview.json');
  writeFileSync(reportPath, JSON.stringify({ scanned: rows.length, invalid,
    duplicates, leadReferences, crossCompanyProfiles, preview }, null, 2));
  const summary = { mode: apply ? 'apply' : 'dry-run', scanned: rows.length,
    duplicateGroups: duplicates.length, rowsToRemove: duplicates.reduce((sum, group) => sum + group.remove.length, 0),
    groupsWithLinkedLead: count(row => Boolean(row.leadId)),
    leadsScanned: leadReferences.scanned, invalidLeadJson: leadReferences.invalidJson,
    groupsWithReverseLeadReference: duplicates.filter(group => group.remove.some(row =>
      Boolean(leadReferences.references[row.$id]))).length,
    groupsWithMixedStatuses: duplicates.filter(group =>
      new Set([group.keeper, ...group.remove].map(row => row.status)).size > 1).length,
    groupsWhereFirstWithdrawnButLaterActive: duplicates.filter(group => group.keeper.status === 'withdrawn' &&
      group.remove.some(row => row.status !== 'withdrawn')).length,
    leadRewrites: duplicates.reduce((sum, group) => sum + group.leadRewrites.length, 0),
    blockedGroups: duplicates.filter(group => group.blockedReason).length,
    crossCompanyProfiles, invalid: invalid.length, preview, reportPath };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;
  if (!expectedPreview || expectedPreview !== preview) {
    throw new Error('Live data changed since the reviewed dry run. Run the dry preview again.');
  }
  if (duplicates.some(group => group.blockedReason)) {
    throw new Error('Some groups have multiple linked leads; resolve them before applying cleanup.');
  }

  const linkedLeadIds = [...new Set(duplicates.flatMap(group => group.leadRewrites.map(rewrite => rewrite.leadId)))];
  const leads = [];
  for (let index = 0; index < linkedLeadIds.length; index += 4) {
    const batch = await Promise.all(linkedLeadIds.slice(index, index + 4).map(id =>
      retry(() => databases.getDocument(databaseId, leadsCollection, id))));
    leads.push(...batch);
  }
  const backupPath = path.join(tmpdir(), `crm-linkedin-duplicate-backup-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify({ preview, duplicates, leads }, null, 2));
  console.log(JSON.stringify({ backupPath, groups: duplicates.length, linkedLeads: leads.length }));

  let nextIndex = 0;
  let completed = 0;
  let updated = 0;
  let deleted = 0;
  let rewired = 0;
  const failed: Array<{ key: string; error: string }> = [];
  async function processGroup(group: (typeof duplicates)[number]) {
    const originals = [group.keeper, ...group.remove];
    const current = await Promise.all(originals.map(row => retry(() =>
      databases.getDocument(databaseId, requestsCollection, row.$id))));
    if (current.some((row, index) => row.$updatedAt !== originals[index].$updatedAt)) {
      throw new Error('Request changed since preview');
    }
    const temporaryTargetUrl = `${group.keeperAfter.targetUrl}?crmCleanup=${group.keeper.$id}`;
    await retry(() => databases.updateDocument(databaseId, requestsCollection, group.keeper.$id, {
      targetUrl: temporaryTargetUrl,
      status: group.keeperAfter.status,
      isActive: group.keeperAfter.isActive,
      dateSent: group.keeperAfter.dateSent,
      acceptedAt: group.keeperAfter.acceptedAt,
      withdrawnAt: group.keeperAfter.withdrawnAt,
      leadId: group.keeperAfter.leadId,
    }));
    for (const rewrite of group.leadRewrites) {
      const lead = await retry(() => databases.getDocument(databaseId, leadsCollection, rewrite.leadId));
      const data = JSON.parse(lead.data as string) as { linkedinRequestId?: unknown };
      if (data.linkedinRequestId !== rewrite.fromRequestId) {
        throw new Error(`Linked lead ${rewrite.leadId} changed since preview`);
      }
      await retry(() => databases.updateDocument(databaseId, leadsCollection, rewrite.leadId, {
        data: JSON.stringify({ ...data, linkedinRequestId: rewrite.toRequestId }),
      }));
      rewired += 1;
    }
    for (const row of group.remove) {
      const latest = await retry(() => databases.getDocument(databaseId, requestsCollection, row.$id));
      if (latest.$updatedAt !== row.$updatedAt) throw new Error('Duplicate changed during cleanup');
      await retry(() => databases.deleteDocument(databaseId, requestsCollection, row.$id));
      deleted += 1;
    }
    await retry(() => databases.updateDocument(databaseId, requestsCollection, group.keeper.$id, {
      company: group.keeperAfter.company,
      targetUrl: group.keeperAfter.targetUrl,
    }));
    updated += 1;
  }
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= duplicates.length) return;
      try { await processGroup(duplicates[index]); }
      catch (error) { failed.push({ key: duplicates[index].key,
        error: error instanceof Error ? error.message : String(error) }); }
      completed += 1;
      if (completed % 100 === 0) console.log(JSON.stringify({ completed,
        total: duplicates.length, updated, deleted, rewired, failed: failed.length }));
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  const failurePath = path.join(tmpdir(), 'crm-linkedin-duplicate-cleanup-failures.json');
  writeFileSync(failurePath, JSON.stringify(failed, null, 2));
  console.log(JSON.stringify({ completed, updated, deleted, rewired, failed: failed.length,
    backupPath, failurePath }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('LinkedIn duplicate preview failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
