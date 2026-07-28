import { Client, Databases } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  try {
    console.log('Creating fulltext index on targetUrl for LINKEDIN_REQUESTS...');
    await databases.createIndex(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_REQUESTS,
      'targetUrl_fulltext',
      'fulltext',
      ['targetUrl']
    );
    console.log('Successfully created targetUrl_fulltext index.');
  } catch (e: any) {
    if (e.code === 409) {
      console.log('Index targetUrl_fulltext already exists.');
    } else {
      console.error('Error creating targetUrl_fulltext index:', e);
    }
  }
}

main();
