import dotenv from 'dotenv';
import path from 'node:path';
import { Client, Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const apply = process.argv.includes('--apply');
const collectionId = COLLECTIONS.MAINTENANCE_SETTINGS;
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const db = new Databases(client);

async function exists(operation: () => Promise<unknown>) {
  try { await operation(); return true; }
  catch (error) {
    if ((error as { code?: number }).code === 404) return false;
    throw error;
  }
}

async function main() {
  const collectionExists = await exists(() => db.getCollection(DATABASE_ID, collectionId));
  const attributeExists = collectionExists && await exists(() =>
    db.getAttribute(DATABASE_ID, collectionId, 'config'));
  const documentExists = collectionExists && await exists(() =>
    db.getDocument(DATABASE_ID, collectionId, 'global'));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', collectionId,
    createCollection: !collectionExists, createConfigAttribute: !attributeExists,
    createDisabledSettingsDocument: !documentExists,
    documentAccess: 'server only', initialMode: 'off' }, null, 2));
  if (!apply) return;
  if (!collectionExists) await db.createCollection(DATABASE_ID, collectionId,
    'Maintenance Settings', [], true);
  if (!attributeExists) await db.createStringAttribute(DATABASE_ID, collectionId,
    'config', 2000, true);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const attribute = await db.getAttribute(DATABASE_ID, collectionId, 'config');
    if (attribute.status === 'available') {
      if (!documentExists) await db.createDocument(DATABASE_ID, collectionId, 'global', {
        config: JSON.stringify({ enabled: false, endsAt: null, updatedBy: null,
          updatedAt: new Date().toISOString() }),
      });
      return;
    }
    if (attribute.status === 'failed') throw new Error('Maintenance config attribute creation failed.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Maintenance config attribute is still processing.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
