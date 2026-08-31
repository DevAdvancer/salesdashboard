import { Client, Databases } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.CALL_REQUESTS, '6a69078600005a031ec4');
  console.log(JSON.stringify(doc, null, 2));
}

main().catch(console.error);
