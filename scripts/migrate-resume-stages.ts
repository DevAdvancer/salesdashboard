import { Client, Databases, Query } from "node-appwrite";
import { config } from "dotenv";
config({ path: ".env.local" });

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function run() {
  const isApply = process.argv.includes(":apply");
  const dbId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
  const collId = "resume_profiles"; // COLLECTIONS.RESUME_PROFILES
  
  let page = 0;
  let totalUpdated = 0;
  
  while (true) {
    const res = await databases.listDocuments(dbId, collId, [
      Query.limit(100),
      Query.offset(page * 100)
    ]);
    
    if (res.documents.length === 0) break;
    
    for (const doc of res.documents) {
      if (doc.stage && doc.stage.match(/^\d+\.\s/)) {
        const newStage = doc.stage.replace(/^\d+\.\s*/, "").trim();
        console.log(`Will update ${doc.$id} from "${doc.stage}" to "${newStage}"`);
        if (isApply) {
          await databases.updateDocument(dbId, collId, doc.$id, { stage: newStage });
          totalUpdated++;
        }
      }
    }
    
    page++;
  }
  
  console.log(`\nFound/Updated ${totalUpdated} profiles.`);
  if (!isApply) console.log("Run with :apply to save changes.");
}

run().catch(console.error);
