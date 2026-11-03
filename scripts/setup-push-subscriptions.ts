/** Scoped Appwrite migration for Web Push browser subscriptions. Dry by default. */
import { Client, Databases, IndexType } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const apply = process.argv.includes('--apply');
const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) throw new Error('Appwrite endpoint, project, and API key are required.');
const databases = new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
const collectionId = COLLECTIONS.PUSH_SUBSCRIPTIONS;
// One document per browser push endpoint. Server-only: no document permissions.
const attributes = [
  { key: 'userId', size: 36 },
  { key: 'endpoint', size: 2048 },
  { key: 'p256dh', size: 256 },
  { key: 'auth', size: 64 },
] as const;

async function exists() {
  try { await databases.getCollection(DATABASE_ID, collectionId); return true; }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 404) return false;
    throw error;
  }
}

async function waitForAttributes() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await databases.listAttributes(DATABASE_ID, collectionId);
    if (attributes.every(({ key: name }) => result.attributes.some(attr => attr.key === name && attr.status === 'available'))) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Attributes are still processing. Rerun the scoped apply after they become available.');
}

async function main() {
  const found = await exists();
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} ${DATABASE_ID}/${collectionId}`);
  if (!found) console.log('CREATE collection push_subscriptions (document security off, no permissions: server only)');
  if (!apply) {
    console.log('ENSURE required attributes: userId (string 36), endpoint (string 2048), p256dh (string 256), auth (string 64)');
    console.log('ENSURE index: user_idx (userId)');
    console.log('No changes written.');
    return;
  }
  if (!found) await databases.createCollection(DATABASE_ID, collectionId, 'Push Subscriptions', [], false);
  const current = await databases.listAttributes(DATABASE_ID, collectionId);
  for (const attribute of attributes) {
    if (!current.attributes.some(item => item.key === attribute.key)) {
      await databases.createStringAttribute(DATABASE_ID, collectionId, attribute.key, attribute.size, true);
    }
  }
  await waitForAttributes();
  const indexes = await databases.listIndexes(DATABASE_ID, collectionId);
  if (!indexes.indexes.some(item => item.key === 'user_idx')) {
    await databases.createIndex(DATABASE_ID, collectionId, 'user_idx', IndexType.Key, ['userId']);
  }
  console.log('Push subscription schema is ready.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Schema setup failed.'); process.exitCode = 1; });
