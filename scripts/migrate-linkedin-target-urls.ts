/**
 * Canonicalize LinkedIn Request targetUrl values without changing request history.
 * Run the dry preview first, then rerun with --apply after reviewing its diff.
 */
import { Client, Databases, Query } from 'node-appwrite';
import dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeProfileUrl } from '../lib/utils/linkedin-extension-url';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID || 'linkedin_requests';
const apply = process.argv.includes('--apply');

if (!projectId || !apiKey) throw new Error('Appwrite project ID and API key are required.');

const databases = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
type RequestRow = { $id: string; targetUrl: string; company?: string; isActive?: boolean;
  status?: string; dateSent?: string; $createdAt?: string; accountId?: string; agentId?: string };
type Change = { id: string; company: string; before: string; after: string };

async function listRequests(): Promise<RequestRow[]> {
  const rows: RequestRow[] = [];
  let cursor: string | null = null;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.select(['$id', 'targetUrl', 'company', 'isActive',
      'status', 'dateSent', '$createdAt', 'accountId', 'agentId']), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments(databaseId, collectionId, queries);
    rows.push(...page.documents as unknown as RequestRow[]);
    if (page.documents.length < 100) return rows;
    cursor = page.documents[page.documents.length - 1].$id;
  }
}

async function main() {
  const rows = await listRequests();
  const changes: Change[] = [];
  const skipped: Array<{ id: string; url: string; reason: string }> = [];
  const byProfile = new Map<string, string[]>();
  const byLogicalCompany = new Map<string, RequestRow[]>();
  for (const row of rows) {
    try {
      const after = normalizeProfileUrl(row.targetUrl);
      const key = JSON.stringify([row.company ?? '', after, row.isActive ?? true]);
      byProfile.set(key, [...(byProfile.get(key) ?? []), row.$id]);
      const logicalCompany = (row.company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const logicalKey = JSON.stringify([logicalCompany, after]);
      byLogicalCompany.set(logicalKey, [...(byLogicalCompany.get(logicalKey) ?? []), row]);
      if (after !== row.targetUrl) changes.push({ id: row.$id,
        company: row.company ?? '', before: row.targetUrl, after });
    } catch (error) {
      skipped.push({ id: row.$id, url: row.targetUrl,
        reason: error instanceof Error ? error.message : 'Invalid URL' });
    }
  }
  // The live unique index is scoped to company, targetUrl, and isActive.
  // Preserve colliding history rows; the app still matches their URL variants.
  const rowById = new Map(rows.map(row => [row.$id, row]));
  const existingHistoryGroups = [...byProfile.values()].filter(ids => ids.length > 1);
  const conflictedIds = new Set(existingHistoryGroups.flat());
  const changeById = new Map(changes.map(change => [change.id, change]));
  const representativeChanges = existingHistoryGroups.flatMap(ids => {
    if (ids.some(id => !changeById.has(id))) return [];
    const ranked = ids.map(id => rowById.get(id)!).sort((left, right) => {
      const accepted = Number(right.status === 'accepted') - Number(left.status === 'accepted');
      if (accepted) return accepted;
      const sent = Date.parse(right.dateSent ?? '') - Date.parse(left.dateSent ?? '');
      if (Number.isFinite(sent) && sent) return sent;
      return Date.parse(right.$createdAt ?? '') - Date.parse(left.$createdAt ?? '');
    });
    const representative = changeById.get(ranked[0].$id);
    return representative ? [representative] : [];
  });
  const representativeIds = new Set(representativeChanges.map(change => change.id));
  const conflictedChanges = changes.filter(change => conflictedIds.has(change.id) &&
    !representativeIds.has(change.id));
  const safeChanges = changes.filter(change => !conflictedIds.has(change.id) ||
    representativeIds.has(change.id));
  const activeSafeChanges = safeChanges.filter(change => {
    const row = rowById.get(change.id);
    return row && (row.isActive ?? true) && row.status !== 'withdrawn';
  });
  const activeConflictedChanges = conflictedChanges.filter(change => {
    const row = rowById.get(change.id);
    return row && (row.isActive ?? true) && row.status !== 'withdrawn';
  });
  const logicalActiveGroups = [...byLogicalCompany.values()].filter(group =>
    group.filter(row => (row.isActive ?? true) && row.status !== 'withdrawn').length > 1);
  const logicalActiveRows = logicalActiveGroups.map(group => group.map(row => ({
    id: row.$id, company: row.company, targetUrl: row.targetUrl, status: row.status,
    dateSent: row.dateSent, createdAt: row.$createdAt, accountId: row.accountId, agentId: row.agentId,
  })));
  const reportPath = path.join(tmpdir(), 'crm-linkedin-target-url-diff.json');
  writeFileSync(reportPath, JSON.stringify({ scanned: rows.length, safeChanges, conflictedChanges,
    skipped, existingHistoryGroups, logicalActiveRows }, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: rows.length,
    changes: changes.length, safeChanges: safeChanges.length, conflictedChanges: conflictedChanges.length,
    skipped: skipped.length, companyHistoryGroups: existingHistoryGroups.length,
    representativeChanges: representativeChanges.length,
    logicalActiveGroups: logicalActiveGroups.length,
    activeSafeChanges: activeSafeChanges.length,
    activeConflictedChanges: activeConflictedChanges.length,
    diffFile: reportPath }, null, 2));
  if (!apply) return;

  const collection = await databases.getCollection(databaseId, collectionId);
  const hasCompanyIndex = collection.indexes.some(index => index.key === 'company_targetUrl_unique' &&
    index.status === 'available' && index.type === 'unique' &&
    JSON.stringify(index.attributes) === JSON.stringify(['company', 'targetUrl', 'isActive']));
  if (!hasCompanyIndex) {
    throw new Error('Apply requires the company-scoped unique index to be available.');
  }

  let updated = 0;
  let changedSincePreview = 0;
  const failed: Array<{ id: string; error: string }> = [];
  let nextIndex = 0;
  let completed = 0;
  async function processChange(change: Change) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const current = await databases.getDocument(databaseId, collectionId, change.id);
        if (current.targetUrl !== change.before) {
          changedSincePreview += 1;
          return;
        }
        await databases.updateDocument(databaseId, collectionId, change.id, { targetUrl: change.after });
        updated += 1;
        return;
      } catch (error) {
        const code = (error as { code?: number }).code;
        const transientNetworkError = error instanceof Error &&
          (error.message === 'fetch failed' || error.name === 'TypeError');
        if ((code === 429 || (code && code >= 500) || transientNetworkError) && attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
          continue;
        }
        failed.push({ id: change.id, error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
  }
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= safeChanges.length) return;
      await processChange(safeChanges[index]);
      completed += 1;
      if (completed % 1000 === 0) {
        console.log(JSON.stringify({ completed, total: safeChanges.length, updated,
          changedSincePreview, failed: failed.length }));
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, () => worker()));
  const failurePath = path.join(tmpdir(), 'crm-linkedin-target-url-failures.json');
  writeFileSync(failurePath, JSON.stringify(failed, null, 2));
  console.log(JSON.stringify({ updated, changedSincePreview, failed: failed.length,
    failurePath }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('LinkedIn target URL migration failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
