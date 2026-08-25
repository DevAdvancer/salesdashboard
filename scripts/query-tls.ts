import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { Query } from "node-appwrite";

async function main() {
  const { databases } = await createAdminClient();
  const teamLeadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "team_lead"),
  ]);
  const teamLeads = teamLeadsResponse.documents;
  for (const tl of teamLeads) {
    console.log(`TL: ${tl.name} | ID: ${tl.$id} | branchId: ${tl.branchId} | branchIds: ${tl.branchIds}`);
  }
}

main();
