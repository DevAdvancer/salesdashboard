import { Client, Databases } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DATABASE_ID } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

// Hardcoded collection IDs for deletion so we don't depend on constants that might be removed
const ACCESS_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID || 'access_config';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';

async function main() {
  try {
    console.log(`Deleting ${ACCESS_CONFIG_COLLECTION_ID}...`);
    await databases.deleteCollection(DATABASE_ID, ACCESS_CONFIG_COLLECTION_ID);
    console.log(`Successfully deleted ${ACCESS_CONFIG_COLLECTION_ID}`);
  } catch (e: any) {
    console.error(`Failed to delete ${ACCESS_CONFIG_COLLECTION_ID}:`, e.message);
  }

  try {
    console.log(`Deleting ${AUDIT_LOGS_COLLECTION_ID}...`);
    await databases.deleteCollection(DATABASE_ID, AUDIT_LOGS_COLLECTION_ID);
    console.log(`Successfully deleted ${AUDIT_LOGS_COLLECTION_ID}`);
  } catch (e: any) {
    console.error(`Failed to delete ${AUDIT_LOGS_COLLECTION_ID}:`, e.message);
  }
}

main();
