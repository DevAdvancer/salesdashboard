import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

async function run() {
  const { databases } = await createAdminClient();

  const pId = "698cf919002eeb11c3b5";

  const payments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.equal("updatedById", pId),
      Query.greaterThanEqual("createdAt", "2026-08-01"),
    ]
  });

  for (const p of payments) {
    let amt = 0;
    try {
      const plan = JSON.parse(p.paymentPlan || p.paymentPlanJson || "{}");
      amt = plan.upfrontAmount || 0;
    } catch {}
    console.log(`Payment Date: ${p.createdAt}, Amount: ${amt}, Lead: ${p.leadId}, UpdatedBy: ${p.updatedById}`);
  }

  const leads = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.equal("ownerId", pId),
      Query.greaterThanEqual("$createdAt", "2026-08-01"),
    ]
  });

  for (const l of leads) {
    let amt = 0;
    try {
      const d = JSON.parse(l.data || "{}");
      amt = d.upfrontAmount || 0;
    } catch {}
    console.log(`Lead created: ${l.$createdAt}, Upfront: ${amt}, ID: ${l.$id}`);
  }
}

run().catch(console.error);
