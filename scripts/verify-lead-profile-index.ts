import dotenv from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Databases, Query } from 'node-appwrite';
import { ServerAppwriteClient } from '../lib/server/appwrite-client';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
dotenv.config({ path: path.resolve('.env'), quiet: true });
async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { indexedProfileCandidates, LEAD_PROFILE_CHECKPOINT } = await import('../lib/server/lead-profile-index');
  const db = new Databases(new ServerAppwriteClient().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
  const checkpoint = await db.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT);
  const baseline = await db.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [Query.limit(1), Query.select(['$id'])]);
  const samples = await db.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY,
    [Query.equal('kind', 'lead-index'), Query.limit(5), Query.select(['profileUrl'])]);
  const cases = [{ kind: 'unfamiliar', url: `https://linkedin.com/in/verify-${randomUUID()}` },
    ...samples.documents.map(row => ({ kind: 'existing', url: String(row.profileUrl) }))];
  const results = [];
  for (const item of cases) {
    let leadRows = 0; let leadReadOperations = 0; let totalReadOperations = 0;
    const metered = new Proxy(db, { get(target, property) {
      if (property === 'listDocuments') return async (...args: Parameters<Databases['listDocuments']>) => {
        const response = await target.listDocuments(...args);
        const reads = Math.max(1, response.documents.length);
        totalReadOperations += reads;
        if (args[1] === COLLECTIONS.LEADS) { leadRows += response.documents.length; leadReadOperations += reads; }
        return response;
      };
      if (property === 'getDocument') return async (...args: Parameters<Databases['getDocument']>) => {
        totalReadOperations++; return target.getDocument(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const start = Date.now();
    const candidates = await indexedProfileCandidates(metered, item.url);
    if (!candidates) throw new Error('The live index lookup fell back. Check schema/index readiness.');
    results.push({ kind: item.kind, baselineFullScanRows: baseline.total, leadRows, leadReadOperations, totalReadOperations, durationMs: Date.now() - start });
  }
  console.log(JSON.stringify({ mode: 'read-only', checkpoint: checkpoint.profileUrl, results }, null, 2));
}
main().catch(error => { console.error('Index verification failed:', error instanceof Error ? error.message : 'Appwrite request failed'); process.exitCode = 1; });
