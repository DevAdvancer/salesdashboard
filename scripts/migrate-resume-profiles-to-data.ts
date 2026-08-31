import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';
import { createAdminClient } from '../lib/server/appwrite';
import { Query } from 'node-appwrite';

const MIGRATION_FIELDS = [
  'technology',
  'usaArrival',
  'bachelors',
  'masters',
  'cpt',
  'cptDetails',
  'opt',
  'optDetails',
  'stemOpt',
  'stemOptDetails',
  'experience',
  'missingDocs',
  'resumeTimeline',
  'remarks',
];

async function run() {
  const isApply = process.argv.includes(':apply');
  console.log(`Starting migration: Resume Profiles fields to data JSON ${isApply ? '[APPLY]' : '[DRY RUN]'}`);

  const { databases } = await createAdminClient();

  let hasMore = true;
  let cursor: string | undefined = undefined;
  let totalProcessed = 0;
  let totalMigrated = 0;

  while (hasMore) {
    const queries = [Query.limit(100)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, queries);

    if (response.documents.length === 0) {
      hasMore = false;
      break;
    }

    for (const doc of response.documents) {
      totalProcessed++;
      
      let existingData: Record<string, any> = {};
      if (doc.data) {
        try {
          existingData = JSON.parse(doc.data);
        } catch (e) {
          console.warn(`[WARN] Doc ${doc.$id}: Failed to parse existing data string.`);
        }
      }

      let needsMigration = false;
      for (const field of MIGRATION_FIELDS) {
        if (doc[field] !== undefined && doc[field] !== null && doc[field] !== '') {
          if (existingData[field] === undefined) {
            existingData[field] = doc[field];
            needsMigration = true;
          }
        }
      }

      if (needsMigration) {
        totalMigrated++;
        const newDataString = JSON.stringify(existingData);
        console.log(`[${doc.$id}] Will migrate ${MIGRATION_FIELDS.filter(f => existingData[f]).join(', ')}`);
        
        if (isApply) {
          try {
            await databases.updateDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, doc.$id, {
              data: newDataString,
            });
            console.log(`  -> Applied`);
          } catch (e: any) {
            console.error(`  -> Failed: ${e.message}`);
          }
        }
      }
    }

    cursor = response.documents[response.documents.length - 1].$id;
    if (response.documents.length < 100) {
      hasMore = false;
    }
  }

  console.log(`\nMigration complete. Processed ${totalProcessed} profiles. Migrated ${totalMigrated} profiles.`);
  if (!isApply) {
    console.log('Run with ":apply" to execute changes.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
