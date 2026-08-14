import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";
import { ID } from "node-appwrite";

async function fixFollowups() {
  const { databases } = await createAdminClient();
  const ids = ["6a738e2a0014d352d3d1", "6a738e400023bbcc31ab"];

  for (const id of ids) {
    try {
      const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, id);
      console.log(`Original document ${id} fetched.`);

      // Prepare payload
      const payload: any = { ...doc };
      delete payload.$id;
      delete payload.$createdAt;
      delete payload.$updatedAt;
      delete payload.$permissions;
      delete payload.$databaseId;
      delete payload.$collectionId;
      delete payload.$sequence;
      delete payload.remark;

      // Set the new values
      payload.createdByName = "Dhananjay Patil";
      payload.createdById = "698d004c0009d3e35e77";

      // Recreate
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, id);
      const newDoc = await databases.createDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, id, payload);
      
      console.log(`Successfully recreated ${id}: createdByName = ${newDoc.createdByName}`);
    } catch (err: any) {
      console.error(`Error processing ${id}:`, err?.message || err);
    }
  }
}

fixFollowups().catch(console.error);
