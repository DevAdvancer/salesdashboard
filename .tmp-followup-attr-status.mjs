import { Client, Databases } from "node-appwrite";
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? "crm-database-1";
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? "previous_followups_payments";
for (const key of ["remark","paymentRemark","updatedAt","updatedById","updatedByName"]) {
  try {
    const attr = await db.getAttribute(databaseId, collectionId, key);
    console.log(JSON.stringify({ key, status: attr.status ?? null, error: attr.error ?? null, type: attr.type ?? null, required: attr.required ?? null }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ key, getAttributeError: error?.message ?? String(error) }, null, 2));
  }
}
