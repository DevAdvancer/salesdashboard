import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "../lib/server/appwrite-pagination";

async function main() {
  const { databases } = await createAdminClient();
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [Query.equal("leadId", "6a3d4c7b003ac34415eb")],
    pageLimit: 10,
    maxPages: 1
  });
  console.log("Client Payments for lead:", docs.length);
  for (const d of docs) {
    console.log(" - updates:", d.updatesJson || d.updates);
    console.log(" - paymentPlan:", d.paymentPlanJson || d.paymentPlan);
  }
}
main().catch(console.error);
