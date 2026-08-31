import { Client, Databases, Query } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  const result = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.CALL_REQUESTS,
    [
      Query.notEqual('status', 'moved_to_marketing'),
      Query.orderDesc('$createdAt'),
      Query.limit(100)
    ]
  );
  console.log(`Returned ${result.documents.length} call requests:`);
  result.documents.forEach((r: any) => console.log(`${r.$id}: ${r.status}`));
}

main().catch(console.error);
