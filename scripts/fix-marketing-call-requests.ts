import { Client, Databases, Query } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';
import { listAllDocuments } from '../lib/server/appwrite-pagination';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
  const isApply = process.argv.includes(':apply');

  console.log(`Fetching Resume Profiles that are moved to Marketing...`);
  const marketingProfiles = await listAllDocuments({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.RESUME_PROFILES,
    queries: [Query.equal('movedToMarketing', true)],
  });

  console.log(`Found ${marketingProfiles.length} profiles moved to marketing.`);

  let callRequestsToUpdate = 0;

  for (const profile of marketingProfiles) {
    if (profile.callRequestId) {
      try {
        const callRequest = await databases.getDocument(
          DATABASE_ID,
          COLLECTIONS.CALL_REQUESTS,
          profile.callRequestId
        );

        if (callRequest.status !== 'moved_to_marketing') {
          console.log(`[${isApply ? 'APPLY' : 'DRY'}] Profile ${profile.$id} (Candidate: ${profile.candidateName}) is in marketing. Call Request ${callRequest.$id} status is ${callRequest.status}. Updating to 'moved_to_marketing'.`);
          callRequestsToUpdate++;

          if (isApply) {
            await databases.updateDocument(
              DATABASE_ID,
              COLLECTIONS.CALL_REQUESTS,
              callRequest.$id,
              { status: 'moved_to_marketing', updatedAt: new Date().toISOString() }
            );
          }
        }
      } catch (e) {
        console.warn(`Error processing call request ${profile.callRequestId} for profile ${profile.$id}:`, e);
      }
    }
  }

  console.log(`\nFound ${callRequestsToUpdate} call requests to update.`);
  if (!isApply && callRequestsToUpdate > 0) {
    console.log(`Run with ':apply' to perform the updates.`);
  }
}

main().catch(console.error);
