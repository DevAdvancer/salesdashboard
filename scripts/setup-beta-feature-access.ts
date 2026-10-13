/** Scoped Appwrite migration for the LinkedIn Helper beta allowlist. Dry by default. */
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
const collectionId = COLLECTIONS.BETA_FEATURE_ACCESS;
const attributes = [
  { key: 'feature', size: 50 },
  { key: 'userId', size: 255 },
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
    if (['feature', 'userId', 'enabled'].every(name => result.attributes.some(attr => attr.key === name && attr.status === 'available'))) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Attributes are still processing. Rerun the scoped apply after they become available.');
}

async function main() {
  const found = await exists();
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} ${DATABASE_ID}/${collectionId}`);
  if (!found) console.log('CREATE collection beta_feature_access');
  if (!apply) {
    console.log('ENSURE required attributes: feature (string 50), userId (string 255), enabled (boolean)');
    console.log('ENSURE unique index: feature_user_idx (feature, userId)');
    console.log('No changes written.');
    return;
  }
  if (!found) await databases.createCollection(DATABASE_ID, collectionId, 'Beta Feature Access');
  const current = await databases.listAttributes(DATABASE_ID, collectionId);
  for (const attribute of attributes) {
    if (!current.attributes.some(item => item.key === attribute.key)) {
      await databases.createStringAttribute(DATABASE_ID, collectionId, attribute.key, attribute.size, true);
    }
  }
  if (!current.attributes.some(item => item.key === 'enabled')) {
    await databases.createBooleanAttribute(DATABASE_ID, collectionId, 'enabled', true);
  }
  await waitForAttributes();
  const indexes = await databases.listIndexes(DATABASE_ID, collectionId);
  if (!indexes.indexes.some(item => item.key === 'feature_user_idx')) {
    await databases.createIndex(DATABASE_ID, collectionId, 'feature_user_idx', IndexType.Unique, ['feature', 'userId']);
  }
  console.log('Beta feature access schema is ready.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Schema setup failed.'); process.exitCode = 1; });
