import { Client, Databases, Query } from "node-appwrite";
import { mkdir, writeFile } from "node:fs/promises";
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? "crm-database-1";
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? "previous_followups_payments";
const res = await db.listDocuments(databaseId, collectionId, [Query.limit(100)]);
const repaired = [];
for (const doc of res.documents) {
  if (!Object.prototype.hasOwnProperty.call(doc, "remark")) continue;
  const payload = {
    leadId: typeof doc.leadId === "string" ? doc.leadId : `manual_followup:repair:${doc.$id}`,
    company: doc.company,
    candidateName: doc.candidateName,
    amount: Number(doc.amount) || 0,
    date: typeof doc.date === "string" ? doc.date : "",
    status: typeof doc.status === "string" && doc.status.trim() ? doc.status : "paid",
    createdAt: typeof doc.createdAt === "string" && doc.createdAt.trim() ? doc.createdAt : doc.$createdAt,
    ...(typeof doc.paymentRemark === "string" && doc.paymentRemark.trim() ? { paymentRemark: doc.paymentRemark.trim() } : {}),
    ...(typeof doc.updatedAt === "string" && doc.updatedAt.trim() ? { updatedAt: doc.updatedAt } : {}),
    ...(typeof doc.updatedById === "string" && doc.updatedById.trim() ? { updatedById: doc.updatedById } : {}),
    ...(typeof doc.updatedByName === "string" && doc.updatedByName.trim() ? { updatedByName: doc.updatedByName } : {}),
  };
  await db.deleteDocument(databaseId, collectionId, doc.$id);
  await db.createDocument(databaseId, collectionId, doc.$id, payload);
  repaired.push({ id: doc.$id, candidateName: doc.candidateName, paymentRemark: payload.paymentRemark ?? null });
  console.log(`repaired ${doc.$id} ${doc.candidateName}`);
}
await mkdir(".dbg", { recursive: true });
await writeFile(".dbg/followup-legacy-repair.json", JSON.stringify({ repairedCount: repaired.length, repaired }, null, 2));
console.log(JSON.stringify({ repairedCount: repaired.length }, null, 2));
