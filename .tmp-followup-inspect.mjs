import { Client, Databases, Query } from "node-appwrite";
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? "crm-database-1";
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? "previous_followups_payments";
const res = await db.listDocuments(databaseId, collectionId, [Query.limit(10), Query.orderDesc("$createdAt")]);
console.log(JSON.stringify(res.documents.map((d) => ({ id: d.$id, candidateName: d.candidateName, company: d.company, date: d.date, paymentRemark: d.paymentRemark ?? null, remark: d.remark ?? null, status: d.status ?? null, updatedAt: d.updatedAt ?? null, updatedById: d.updatedById ?? null })), null, 2));
