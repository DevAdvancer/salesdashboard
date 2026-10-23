import { createHash } from 'node:crypto';
import { Query, type Databases, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { LEAD_PROFILE_CHECKPOINT, LEAD_PROFILE_KEY, leadProfileIndexKey } from '@/lib/server/lead-profile-index';

export async function profileIndexPlan(db: Databases) {
  let previous: Models.Document | null = null;
  if (typeof db.getDocument === 'function') {
    try { previous = await db.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT); }
    catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
  }
  const since = previous?.leadId === 'ready' && Number.isFinite(Date.parse(previous.profileUrl)) ? String(previous.profileUrl) : null;
  const readLeads = () => listAllDocuments<Models.Document>({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
    queries: [...(since ? [Query.greaterThanEqual('$updatedAt', since)] : []), Query.orderAsc('$id'), Query.select(['$id', 'data', '$updatedAt'])], pageLimit: 5000, requireComplete: true, maxDocuments: 100000 });
  const entryId = (id: string) => `i_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
  const readEntries = async (source: Models.Document[]) => {
    if (since) {
      const result: Models.Document[] = [];
      for (let offset = 0; offset < source.length; offset += 100) {
        const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY,
          [Query.equal('$id', source.slice(offset, offset + 100).map(row => entryId(row.$id))), Query.limit(100)]);
        result.push(...page.documents);
      }
      return result;
    }
    return listAllDocuments<Models.Document>({ databases: db, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_LEAD_REGISTRY, queries: [Query.equal('kind', 'lead-index'), Query.orderAsc('$id')],
    pageLimit: 5000, requireComplete: true, maxDocuments: 100000 });
  };
  const leads = await readLeads();
  const existing = await readEntries(leads);
  const byId = new Map(existing.map(row => [row.$id, row]));
  const wanted = (lead: Models.Document) => ({
    id: entryId(lead.$id),
    data: { kind: 'lead-index', leadId: lead.$id, profileUrl: leadProfileUrl(lead.data) || '', [LEAD_PROFILE_KEY]: leadProfileIndexKey(lead.data) },
  });
  const records = leads.filter(lead => leadProfileUrl(lead.data)).map(wanted);
  const writes = records.filter(row => !byId.has(row.id) ||
    Object.entries(row.data).some(([key, value]) => byId.get(row.id)![key] !== value));
  // Stale entries are harmless: lookup always re-reads and normalizes the live
  // lead. Keeping them avoids delete operations and preserves recovery evidence.
  const plan = createHash('sha256').update(JSON.stringify([since, writes])).digest('hex');
  return { plan, scanned: leads.length, writes, apply: async () => {
    const lockId = 'profile-index-refresh';
    const lock = await db.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, lockId,
      { kind: 'index-lock', profileUrl: LEAD_PROFILE_CHECKPOINT, leadId: 'system' }, []);
    try {
    // A plan prepared before another refresh committed must never overwrite its
    // verified metadata. Re-read under the lock before performing any writes.
    if ((await profileIndexPlan(db)).plan !== plan) throw new Error('Index source changed. Run the dry preview again.');
    for (const row of writes) {
      if (byId.has(row.id)) await db.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, row.id, row.data, []);
      else await db.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, row.id, row.data, []);
    }
    // Capture BEFORE verification; later changes are always in the delta query.
    const checkpoint = lock.$createdAt; // Appwrite's clock, not the CLI host clock.
    if (!Number.isFinite(Date.parse(checkpoint))) throw new Error('The database did not return a valid checkpoint timestamp.');
    const freshLeads = await readLeads();
    const freshEntries = await readEntries(freshLeads);
    const freshMap = new Map(freshEntries.map(row => [row.$id, row]));
    const misses = freshLeads.filter(lead => {
      if (Date.parse(lead.$updatedAt) >= Date.parse(checkpoint) || !leadProfileUrl(lead.data)) return false;
      const row = wanted(lead);
      return freshMap.get(row.id)?.[LEAD_PROFILE_KEY] !== row.data[LEAD_PROFILE_KEY] || freshMap.get(row.id)?.leadId !== lead.$id;
    });
    if (misses.length) throw new Error(`Index verification failed for ${misses.length} historical records. Checkpoint was not advanced.`);
    const marker = { kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: checkpoint };
    try { await db.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT, marker, []); }
    catch (error) {
      if ((error as { code?: number }).code !== 409) throw error;
      await db.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT, marker, []);
    }
    return { scanned: freshLeads.length, indexRecordsWritten: writes.length, checkpoint };
    } finally { await db.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, lockId); }
  } };
}
