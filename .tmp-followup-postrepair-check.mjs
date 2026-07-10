import { Client, Databases } from "node-appwrite";
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? "crm-database-1";
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? "previous_followups_payments";
const doc = await db.getDocument(databaseId, collectionId, "6a51567400216b8568aa");
console.log(JSON.stringify({ id: doc.$id, hasRemark: Object.prototype.hasOwnProperty.call(doc, "remark"), remark: doc.remark ?? null, paymentRemark: doc.paymentRemark ?? null, updatedAt: doc.updatedAt ?? null }, null, 2));
