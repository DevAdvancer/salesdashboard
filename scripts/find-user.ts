import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
async function run() {
  const { databases } = await createAdminClient();
  const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.limit(5000)
  ]);
  console.log(docs.documents.filter(d => d.name.toLowerCase().includes("prakash")).map(d => ({ id: d.$id, name: d.name })));
}
run().catch(console.error);
