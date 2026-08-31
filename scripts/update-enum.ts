import { Client, Databases } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  console.log('Updating enum for call_requests.status...');
  
  await databases.updateEnumAttribute(
    DATABASE_ID,
    COLLECTIONS.CALL_REQUESTS,
    'status',
    ['not_called', 'pending_documents', 'call_done', 'moved_to_marketing'],
    false,
    'not_called'
  );

  console.log('Done!');
}

main().catch(console.error);
