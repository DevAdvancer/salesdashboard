import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

async function run() {
  const { databases } = await createAdminClient();

  const pId = "698cf919002eeb11c3b5";
  const dateKey = "2026-08-10";
  const startIso = `${dateKey}T00:00:00.000Z`;
  const endIso = `${dateKey}T23:59:59.999Z`;

  console.log("Checking inputs for", dateKey);

  const payments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("createdAt", startIso),
      Query.lessThanEqual("createdAt", endIso)
    ]
  });

  let total = 0;
  for (const p of payments) {
    if (p.updatedById === pId || p.userId === pId) {
      let amt = 0;
      try {
        const plan = JSON.parse(p.paymentPlan || p.paymentPlanJson || "{}");
        amt = plan.upfrontAmount || 0;
      } catch {}
      console.log(`Payment: ${amt}, Lead: ${p.leadId}, Status: ${p.status}`);
      total += amt;
    }
  }

  const leads = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.greaterThanEqual("closedAt", startIso),
      Query.lessThanEqual("closedAt", endIso)
    ]
  });

  for (const l of leads) {
    if (l.ownerId === pId || l.assignedToId === pId) {
      if (l.isClosed || l.status === "closed") {
        let amt = 0;
        try {
          const d = JSON.parse(l.data || "{}");
          amt = Number(d.upfrontAmount) || 0;
        } catch {}
        console.log(`Lead closed: ${amt}, ID: ${l.$id}`);
        total += amt;
      }
    }
  }

  console.log("Total from raw inputs:", total);
}

run().catch(console.error);
