/** Retire only the personal Reminders collection. Dry-run by default. */
import { Client, Databases, Query, type Models } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { listAllDocuments } from '../lib/server/appwrite-pagination';

async function main() {
  dotenv.config({ path: path.resolve('.env'), quiet: true });
  dotenv.config({ path: path.resolve('.env.local'), override: true, quiet: true });
  const { DATABASE_ID } = await import('../lib/constants/appwrite');
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  const collectionId = process.env.NEXT_PUBLIC_APPWRITE_CALENDAR_EVENTS_COLLECTION_ID || 'calendar_events';
  if (!endpoint || !projectId || !apiKey || !DATABASE_ID) throw new Error('Missing Appwrite configuration.');
  // An unexpected override must never cause another business collection to be deleted.
  if (collectionId !== 'calendar_events') throw new Error('Unexpected collection override; review the retirement script before continuing.');
  const databases = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
  const schema = await databases.getCollection(DATABASE_ID, collectionId).catch((error: { code?: number }) => {
    if (error.code === 404) return null;
    throw error;
  });
  if (!schema) {
    console.log(JSON.stringify({ alreadyRemoved: true, projectId, databaseId: DATABASE_ID, collectionId }));
    return;
  }
  const attributes = new Set(schema.attributes.map(attribute => attribute.key));
  if (!['userId', 'type', 'date', 'reminderEnabled', 'reminderSent'].every(key => attributes.has(key))) {
    throw new Error('The collection does not match the personal Reminders schema.');
  }
  const documents = await listAllDocuments<Models.Document>({ databases, databaseId: DATABASE_ID, collectionId,
    queries: [Query.orderAsc('$id')], pageLimit: 100, maxPages: 1000, requireComplete: true });
  const plan = { endpoint, projectId, databaseId: DATABASE_ID, collectionId, action: 'deleteCollection',
    documentCount: documents.length, schemaUpdatedAt: schema.$updatedAt,
    documents: documents.map(doc => ({ id: doc.$id, updatedAt: doc.$updatedAt })) };
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  console.log(JSON.stringify({ ...plan, documents: undefined, planHash }, null, 2));
  if (!process.argv.includes('--apply')) return;
  if (!process.argv.includes(`--plan=${planHash}`)) throw new Error('Apply requires the matching --plan=<hash> from the reviewed dry-run.');

  const backupDirectory = path.resolve('outputs', 'reminders-retirement');
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `${Date.now()}-${planHash.slice(0, 12)}.json`);
  await writeFile(backupPath, JSON.stringify({ plan, schema, documents }, null, 2), { flag: 'wx' });
  await databases.deleteCollection(DATABASE_ID, collectionId);
  const stillExists = await databases.getCollection(DATABASE_ID, collectionId).then(() => true,
    (error: { code?: number }) => { if (error.code === 404) return false; throw error; });
  if (stillExists) throw new Error('Collection still exists after deletion.');
  console.log(JSON.stringify({ removed: true, collectionId, backupPath }));
}

main().catch(() => { console.error('Reminders retirement failed. No credentials or document content are logged.'); process.exitCode = 1; });
