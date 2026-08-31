import { Client, Databases, Query } from 'node-appwrite';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const COLLECTIONS = {
  RESUME_PROFILES: process.env.NEXT_PUBLIC_APPWRITE_RESUME_PROFILES_COLLECTION_ID || 'resume_profiles',
};

async function run() {
  console.log('Fetching profiles...');
  let totalFixed = 0;
  
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, [
    Query.limit(100)
  ]);
  
  for (const doc of res.documents) {
    if (!doc.complianceStatus) {
      console.log(`Fixing ${doc.$id} (${doc.candidateName})`);
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, doc.$id, {
        complianceStatus: 'pending'
      });
      totalFixed++;
    }
  }
  
  console.log(`Fixed ${totalFixed} profiles.`);
}

run().catch(console.error);
