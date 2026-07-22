import { Client, Databases, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'main_db';
const COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_RESUME_PROFILES_COLLECTION_ID || 'resume_profiles';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function migrate() {
  console.log('Starting data migration: indiaExperience -> experience');

  try {
    let offset = 0;
    const limit = 100;
    let totalUpdated = 0;
    
    while (true) {
      // Find documents where indiaExperience is not null
      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [
          Query.limit(limit),
          Query.offset(offset),
          Query.isNotNull('indiaExperience')
        ]
      );
      
      const docs = response.documents;
      if (docs.length === 0) {
        break;
      }
      
      for (const doc of docs) {
        if (doc.indiaExperience) {
          // Parse existing data JSON or create new object
          let dataObj: any = {};
          if (doc.data) {
            try {
              dataObj = JSON.parse(doc.data);
            } catch (e) {
              // ignore
            }
          }
          
          // Set experience in the data object
          dataObj.experience = doc.indiaExperience;
          
          // Update the document
          await databases.updateDocument(
            DATABASE_ID,
            COLLECTION_ID,
            doc.$id,
            {
              data: JSON.stringify(dataObj)
            }
          );
          totalUpdated++;
          process.stdout.write('.');
        }
      }
      
      offset += limit;
    }
    
    console.log(`\nMigration complete. Updated ${totalUpdated} profiles.`);
  } catch (error) {
    console.error('\nMigration failed:', error);
  }
}

migrate();
