import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import { Client, Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';

const collectionId = COLLECTIONS.REPORT_EMAIL_SETTINGS;
const dryRun = !process.argv.includes('--apply');

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const databases = new Databases(client);
  let collectionExists = false;
  try {
    await databases.getCollection(DATABASE_ID, collectionId);
    collectionExists = true;
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 404) throw error;
  }

  if (!collectionExists) {
    console.log(`${dryRun ? 'Would create' : 'Creating'} collection ${collectionId} with server-only access`);
    if (!dryRun) await databases.createCollection(DATABASE_ID, collectionId, 'Report Email Settings');
  }

  let attributeExists = false;
  if (collectionExists) {
    try {
      await databases.getAttribute(DATABASE_ID, collectionId, 'emails');
      attributeExists = true;
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 404) throw error;
    }
  }
  if (!attributeExists) {
    console.log(`${dryRun ? 'Would create' : 'Creating'} required emails string attribute (4000 chars)`);
    if (!dryRun) await databases.createStringAttribute(DATABASE_ID, collectionId, 'emails', 4000, true);
  }
  if (collectionExists && attributeExists) console.log('Report email settings schema is ready.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
