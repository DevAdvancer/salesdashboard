import { Client, Databases, Query } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';
import { listAllDocuments } from '../lib/server/appwrite-pagination';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  const marketingProfiles = await listAllDocuments({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.RESUME_PROFILES,
    queries: [Query.equal('movedToMarketing', true)]
  });

  for (const profile of marketingProfiles) {
    console.log(`Profile: ${profile.$id} | candidateName: ${profile.candidateName} | callRequestId: ${profile.callRequestId}`);
  }
}

main().catch(console.error);
