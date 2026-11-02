import dotenv from 'dotenv';
import path from 'node:path';
import { Client, Databases, IndexType, Query } from 'node-appwrite';

dotenv.config({ path: path.resolve('.env'), quiet: true });
dotenv.config({ path: path.resolve('.env.local'), override: true, quiet: true });

const apply = process.argv.includes('--apply');
const backfill = process.argv.includes('--backfill');
const refreshSource = process.argv.includes('--refresh-source');
type Attribute = { key: string; type: 'string' | 'boolean' | 'datetime'; size?: number; required?: boolean; default?: string };
const string = (key: string, size: number): Attribute => ({ key, type: 'string', size });
async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { syncClientProgress, progressId, closedClient } = await import('../lib/server/client-progress-sync');
  const { listAllDocuments } = await import('../lib/server/appwrite-pagination');
  const db = new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
  const definitions = [
    { id: COLLECTIONS.CLIENT_PROGRESS_SHARES, name: 'Client Progress Shares', attributes: [
      string('entryId', 36), string('tokenHash', 64), string('subjectHash', 64), string('issuerId', 36),
      { key: 'expiresAt', type: 'datetime' }, { key: 'revoked', type: 'boolean' },
      { key: 'includeContact', type: 'boolean' }, { key: 'includeNotes', type: 'boolean' },
    ] as Attribute[], indexes: [] as string[][] },
    { id: COLLECTIONS.CLIENT_PROGRESS, name: 'Client Progress', attributes: [
      string('leadId', 36), string('source', 10), string('candidateName', 200), string('email', 320), string('phone', 80),
      string('salespersonId', 36), string('salespersonName', 200), string('department', 10), string('marketingTl', 200),
      string('recruiterName', 200), string('progressStatus', 30), string('notes', 5000), string('finalFeedback', 5000), string('finalSavedAt', 40),
      { key: 'marketingStartedOn', type: 'string', size: 10, required: false, default: '' },
      { key: 'enteredAt', type: 'datetime' }, { key: 'eligible', type: 'boolean' }, { key: 'assignmentOverride', type: 'boolean' },
    ] as Attribute[], indexes: ['leadId', 'salespersonId', 'department', 'progressStatus', 'candidateName', 'email', 'phone', 'salespersonName', 'marketingTl', 'recruiterName', 'enteredAt', 'eligible'].map(key => [key])
      .concat([['eligible', 'enteredAt'], ['eligible', 'department', 'salespersonId', 'enteredAt']]) },
    { id: COLLECTIONS.CLIENT_PROGRESS_EVENTS, name: 'Client Progress Events', attributes: [
      string('entryId', 36), string('kind', 20), string('text', 15000), string('authorId', 36), string('authorName', 200),
    ], indexes: [['entryId', 'kind', '$createdAt']] },
  ];
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: database ${DATABASE_ID}. No existing lead data will be modified.`);
  for (const definition of definitions) {
    let collection;
    try { collection = await db.getCollection(DATABASE_ID, definition.id); }
    catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
    if (collection && (collection.$permissions.length || collection.documentSecurity)) throw new Error(`${definition.id} must have empty collection permissions and documentSecurity=false.`);
    if (!collection) {
      console.log(`${apply ? 'Create' : 'Would create'} ${definition.id}: server-only, empty permissions, document security disabled.`);
      if (apply) await db.createCollection(DATABASE_ID, definition.id, definition.name, [], false);
    }
    for (const attribute of definition.attributes) {
      const existing = collection?.attributes.find(item => item.key === attribute.key) as { type: string; size?: number; required: boolean; status: string } | undefined;
      if (existing) {
        if (existing.type !== attribute.type || existing.required !== (attribute.required !== false) || (attribute.size && existing.size !== attribute.size)) throw new Error(`Incompatible attribute ${definition.id}.${attribute.key}; review manually.`);
        continue;
      }
      console.log(`${apply ? 'Create' : 'Would create'} ${definition.id}.${attribute.key}: ${attribute.required === false ? 'optional' : 'required'} ${attribute.type}${attribute.size ? `(${attribute.size})` : ''}`);
      if (!apply) continue;
      if (attribute.type === 'string') await db.createStringAttribute(DATABASE_ID, definition.id, attribute.key, attribute.size!, attribute.required !== false, attribute.default);
      if (attribute.type === 'boolean') await db.createBooleanAttribute(DATABASE_ID, definition.id, attribute.key, true);
      if (attribute.type === 'datetime') await db.createDatetimeAttribute(DATABASE_ID, definition.id, attribute.key, true);
    }
    if (apply) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const current = await db.getCollection(DATABASE_ID, definition.id);
        if (current.attributes.some(item => ['failed', 'stuck'].includes(item.status))) throw new Error(`Attribute creation failed for ${definition.id}.`);
        if (definition.attributes.every(attribute => current.attributes.some(item => item.key === attribute.key && item.status === 'available'))) break;
        if (attempt === 59) throw new Error('Timed out waiting for attributes. Rerun the dry run before retrying.');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    for (const keys of definition.indexes) {
      const key = `idx_${keys.map(item => item.replace('$', '')).join('_')}`.slice(0, 36);
      const existing = collection?.indexes.find(item => item.key === key);
      if (existing) {
        if (JSON.stringify(existing.attributes) !== JSON.stringify(keys)) throw new Error(`Incompatible index ${definition.id}.${key}`);
        continue;
      }
      console.log(`${apply ? 'Create' : 'Would create'} index ${definition.id}.${key}: ${keys.join(', ')}`);
      if (apply) await db.createIndex(DATABASE_ID, definition.id, key, IndexType.Key, keys);
    }
  }
  if (backfill) {
    const leads = await listAllDocuments({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
      queries: [Query.equal('isClosed', true), Query.select(['$id', '$createdAt', '$updatedAt', 'data', 'status', 'isClosed', 'ownerId', 'assignedToId', 'closedAt']), Query.orderAsc('$id')], pageLimit: 100, maxPages: 1000 });
    const eligible = leads.filter(closedClient);
    const existing = new Set<string>();
    try {
      for (let start = 0; start < eligible.length; start += 100) {
        const ids = eligible.slice(start, start + 100).map(lead => progressId(lead.$id));
        const result = await db.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, [Query.equal('$id', ids), Query.limit(100), Query.select(['$id'])]);
        result.documents.forEach(row => existing.add(row.$id));
      }
    } catch (error) { if (apply || (error as { code?: number }).code !== 404) throw error; }
    const missing = eligible.filter(lead => !existing.has(progressId(lead.$id)));
    console.log(`Backfill: ${leads.length} closed leads inspected; ${leads.length - eligible.length} excluded; ${existing.size} already tracked; ${missing.length} ${apply ? 'to add' : 'would be added'}. No existing tracking/feedback overwritten.`);
    if (refreshSource) console.log(`Source refresh: ${eligible.length} eligible entries will be compared with source name/contact/assignment fields. Only changed source fields are written; notes, Marketing TL, recruiters and feedback are preserved.`);
    if (apply) {
      let completed = 0;
      const work = refreshSource ? eligible : missing;
      // Bounded setup-only concurrency. Runtime mutations still touch one entry.
      for (let start = 0; start < work.length; start += 4) {
        const results = await Promise.allSettled(work.slice(start, start + 4).map(lead => syncClientProgress(db, null, lead)));
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        const previous = completed;
        completed += results.length;
        if (Math.floor(previous / 50) !== Math.floor(completed / 50)) console.log(`Processed ${completed} source entries.`);
      }
    }
  }
  if (apply) {
    for (const definition of definitions) {
      const current = await db.getCollection(DATABASE_ID, definition.id);
      console.log(`${definition.id}: ${current.attributes.length} attributes, ${current.indexes.length} indexes; permissions=${JSON.stringify(current.$permissions)}.`);
    }
  }
  console.log('Complete.');
}
main().catch(error => { console.error('Setup failed:', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1; });
