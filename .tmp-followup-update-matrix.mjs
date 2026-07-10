import { Client, Databases } from "node-appwrite";
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? "crm-database-1";
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? "previous_followups_payments";
const paymentId = "6a51567400216b8568aa";
for (const payload of [
  { updatedAt: new Date().toISOString() },
  { paymentRemark: "Category - Pending" },
  { remark: "Category - Pending" },
  { company: "Silverspace INC", candidateName: "Guru Revanth Nethi", amount: 1000, date: "2026-07-07", status: "paid" },
]) {
  try {
    const doc = await db.updateDocument(databaseId, collectionId, paymentId, payload);
    console.log(JSON.stringify({ ok: true, keys: Object.keys(payload), id: doc.$id }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, keys: Object.keys(payload), message: error?.message ?? String(error) }, null, 2));
  }
}
