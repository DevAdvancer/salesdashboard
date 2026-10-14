/** Remove legacy LinkedIn Request rows without one identifiable public profile URL. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client, Databases, Query } from 'node-appwrite';
import { normalizeStoredProfileUrl } from '../lib/utils/linkedin-extension-url';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
if (!projectId || !apiKey) throw new Error('Appwrite credentials are required.');
const db = new Databases(new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(projectId).setKey(apiKey));
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const requestsCollection = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID || 'linkedin_requests';
const leadsCollection = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const apply = process.argv.includes('--apply');
const expectedPreview = process.argv.find(value => value.startsWith('--preview='))?.slice(10);
type Row = { $id: string; $updatedAt: string; targetUrl: string; status: string; leadId?: string | null };
type LeadRow = { $id: string; data: string };

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

async function listAll(collectionId: string): Promise<Array<Row & LeadRow>> {
  const result: Array<Row & LeadRow> = [];
  let cursor: string | null = null;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await retry(() => db.listDocuments(databaseId, collectionId, queries));
    result.push(...page.documents as unknown as Array<Row & LeadRow>);
    if (page.documents.length < 100) return result;
    cursor = page.documents.at(-1)!.$id;
  }
}

function isInvalid(row: Row): boolean {
  try { normalizeStoredProfileUrl(row.targetUrl); return false; }
  catch { return true; }
}

async function main() {
  const requests = await listAll(requestsCollection);
  const invalid = requests.filter(isInvalid);
  const invalidIds = new Set(invalid.map(row => row.$id));
  const leads = await listAll(leadsCollection);
  const references = leads.flatMap(lead => {
    try {
      const data = JSON.parse(lead.data) as { linkedinRequestId?: unknown };
      return typeof data.linkedinRequestId === 'string' && invalidIds.has(data.linkedinRequestId)
        ? [{ lead, requestId: data.linkedinRequestId }] : [];
    } catch { return []; }
  });
  const preview = createHash('sha256').update(JSON.stringify({
    rows: invalid.map(row => [row.$id, row.$updatedAt, row.targetUrl]),
    references: references.map(({ lead, requestId }) => [lead.$id, requestId, lead.data]),
  })).digest('hex');
  const reportPath = path.join(tmpdir(), 'crm-linkedin-invalid-removal-preview.json');
  writeFileSync(reportPath, JSON.stringify({ invalid, references: references.map(({ lead, requestId }) =>
    ({ leadId: lead.$id, requestId })), preview }, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: requests.length,
    invalidRows: invalid.length, activeRows: invalid.filter(row => row.status !== 'withdrawn').length,
    directLeadLinks: invalid.filter(row => Boolean(row.leadId)).length,
    reverseLeadReferences: references.length, preview, reportPath }, null, 2));
  if (!apply) return;
  if (!expectedPreview || expectedPreview !== preview) {
    throw new Error('Preview changed. Run the dry command and review the new diff first.');
  }
  const backupPath = path.join(tmpdir(), `crm-linkedin-invalid-removal-backup-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify({ invalid, leads: references.map(item => item.lead) }, null, 2));
  let deleted = 0;
  let unlinked = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const row of invalid) {
    try {
      const current = await retry(() => db.getDocument(databaseId, requestsCollection, row.$id));
      if (current.$updatedAt !== row.$updatedAt || !isInvalid(current as unknown as Row)) {
        throw new Error('Request changed since preview');
      }
      for (const { lead } of references.filter(item => item.requestId === row.$id)) {
        const currentLead = await retry(() => db.getDocument(databaseId, leadsCollection, lead.$id));
        if (currentLead.data !== lead.data) throw new Error(`Lead ${lead.$id} changed since preview`);
        const data = JSON.parse(currentLead.data as string) as Record<string, unknown>;
        if (data.linkedinRequestId !== row.$id) throw new Error(`Lead ${lead.$id} reference changed`);
        delete data.linkedinRequestId;
        await retry(() => db.updateDocument(databaseId, leadsCollection, lead.$id,
          { data: JSON.stringify(data) }));
        unlinked += 1;
      }
      await retry(() => db.deleteDocument(databaseId, requestsCollection, row.$id));
      deleted += 1;
    } catch (error) {
      failures.push({ id: row.$id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const failurePath = path.join(tmpdir(), 'crm-linkedin-invalid-removal-failures.json');
  writeFileSync(failurePath, JSON.stringify(failures, null, 2));
  console.log(JSON.stringify({ deleted, unlinked, failed: failures.length, backupPath, failurePath }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
