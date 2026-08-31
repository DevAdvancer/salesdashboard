import { createAdminClient } from '../lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';
import { Query } from 'node-appwrite';

async function main() {
  const isApply = process.argv.includes(':apply');
  const { databases } = await createAdminClient();
  let cursor: string | undefined = undefined;
  let updatedCount = 0;
  let scannedCount = 0;

  console.log(`Starting backfill of complianceStatus... (dry run = ${!isApply})`);

  while (true) {
    const queries = [Query.limit(100)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.RESUME_PROFILES,
      queries
    );

    if (response.documents.length === 0) break;

    for (const doc of response.documents) {
      scannedCount++;
      if (!doc.complianceStatus) {
        if (isApply) {
          await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.RESUME_PROFILES,
            doc.$id,
            {
              complianceStatus: 'approved',
              complianceApprovedAt: doc.createdAt,
            }
          );
        }
        updatedCount++;
      }
    }

    cursor = response.documents[response.documents.length - 1].$id;
    console.log(`Scanned ${scannedCount}...`);
  }

  console.log(`Done! Scanned ${scannedCount} profiles. Would update/updated ${updatedCount} profiles.`);
}

main().catch(console.error);
