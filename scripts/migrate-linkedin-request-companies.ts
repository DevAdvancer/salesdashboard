/** Align historical LinkedIn request company labels with the current account choices. */
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
const requestsCollection = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID || 'linkedin_requests';
const accountsCollection = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID || 'linkedin_accounts';
const apply = process.argv.includes('--apply');

if (!projectId || !apiKey) throw new Error('Appwrite project ID and API key are required.');
const databases = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));

type RequestRow = { $id: string; company: string; targetUrl: string; isActive?: boolean;
  status?: string; dateSent?: string; $createdAt?: string };
type AccountRow = { $id: string; company: string };
type Change = { id: string; before: string; after: string; targetUrl: string; isActive?: boolean };

const currentCompanies: Record<string, string> = {
  silverspaceinc: 'Silverspace INC',
  vizvainc: 'Vizva INC',
  flawlessed: 'Flawless-ED',
};
function canonicalCompany(value: string): string | null {
  return currentCompanies[value.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null;
}
function indexKey(company: string, targetUrl: string, isActive?: boolean): string {
  return JSON.stringify([company, targetUrl, isActive ?? true]);
}
function isCanonicalProfile(value: string): boolean {
  try { return normalizeProfileUrl(value) === value; } catch { return false; }
}
async function listRows<T>(collectionId: string, fields: string[]): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.select(fields), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments(databaseId, collectionId, queries);
    rows.push(...page.documents as unknown as T[]);
    if (page.documents.length < 100) return rows;
    cursor = page.documents[page.documents.length - 1].$id;
  }
}
async function main() {
  const [rows, accounts] = await Promise.all([
    listRows<RequestRow>(requestsCollection, ['$id', 'company', 'targetUrl', 'isActive',
      'status', 'dateSent', '$createdAt']),
    listRows<AccountRow>(accountsCollection, ['$id', 'company']),
  ]);
  const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value =>
    [value, values.filter(item => item === value).length]));
  const occupied = new Set(rows.map(row => indexKey(row.company, row.targetUrl, row.isActive)));
  const candidates = rows.filter(row => {
    const canonical = canonicalCompany(row.company);
    return canonical && canonical !== row.company;
  }).sort((left, right) => {
    const canonicalUrl = Number(isCanonicalProfile(right.targetUrl)) - Number(isCanonicalProfile(left.targetUrl));
    if (canonicalUrl) return canonicalUrl;
    const accepted = Number(right.status === 'accepted') - Number(left.status === 'accepted');
    if (accepted) return accepted;
    const sent = Date.parse(right.dateSent ?? '') - Date.parse(left.dateSent ?? '');
    if (Number.isFinite(sent) && sent) return sent;
    return Date.parse(right.$createdAt ?? '') - Date.parse(left.$createdAt ?? '');
  });
  const safeChanges: Change[] = [];
  const conflictedChanges: Change[] = [];
  for (const row of candidates) {
    const change = { id: row.$id, before: row.company, after: canonicalCompany(row.company)!,
      targetUrl: row.targetUrl, isActive: row.isActive };
    const key = indexKey(change.after, change.targetUrl, change.isActive);
    if (occupied.has(key)) conflictedChanges.push(change);
    else { safeChanges.push(change); occupied.add(key); }
  }
  const reportPath = path.join(tmpdir(), 'crm-linkedin-request-company-diff.json');
  writeFileSync(reportPath, JSON.stringify({ scanned: rows.length,
    requestCompanyCounts: counts(rows.map(row => row.company)),
    accountCompanyCounts: counts(accounts.map(row => row.company)),
    safeChanges, conflictedChanges }, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: rows.length,
    requestCompanyCounts: counts(rows.map(row => row.company)),
    accountCompanyCounts: counts(accounts.map(row => row.company)),
    safeChanges: safeChanges.length, conflictedChanges: conflictedChanges.length,
    diffFile: reportPath }, null, 2));
  if (!apply) return;

  const collection = await databases.getCollection(databaseId, requestsCollection);
  const hasIndex = collection.indexes.some(index => index.key === 'company_targetUrl_unique' &&
    index.status === 'available' && index.type === 'unique' &&
    JSON.stringify(index.attributes) === JSON.stringify(['company', 'targetUrl', 'isActive']));
  if (!hasIndex) throw new Error('Apply requires the company-scoped unique index to be available.');

  let updated = 0;
  let changedSincePreview = 0;
  let completed = 0;
  let nextIndex = 0;
  const failed: Array<{ id: string; error: string }> = [];
  async function processChange(change: Change) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const current = await databases.getDocument(databaseId, requestsCollection, change.id);
        if (current.company !== change.before || current.targetUrl !== change.targetUrl ||
          (current.isActive ?? true) !== (change.isActive ?? true)) {
          changedSincePreview += 1;
          return;
        }
        await databases.updateDocument(databaseId, requestsCollection, change.id, { company: change.after });
        updated += 1;
        return;
      } catch (error) {
        const code = (error as { code?: number }).code;
        const transient = error instanceof Error && (error.message === 'fetch failed' || error.name === 'TypeError');
        if ((code === 429 || (code && code >= 500) || transient) && attempt < 4) {
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
      if (completed % 1000 === 0) console.log(JSON.stringify({ completed,
        total: safeChanges.length, updated, failed: failed.length }));
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));
  const failurePath = path.join(tmpdir(), 'crm-linkedin-request-company-failures.json');
  writeFileSync(failurePath, JSON.stringify(failed, null, 2));
  console.log(JSON.stringify({ updated, changedSincePreview, failed: failed.length, failurePath }, null, 2));
  if (failed.length) process.exitCode = 1;
}
main().catch(error => {
  console.error('LinkedIn request company migration failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
