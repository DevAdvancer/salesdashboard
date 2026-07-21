import { Client, Databases } from "node-appwrite";

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);

async function main() {
    try {
        const doc = await databases.getDocument(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            "leads", // NEXT_PUBLIC_APPWRITE_COLLECTION_LEADS_ID
            "6a5fd5cf0028f713166f"
        );
        console.log("Document Status:", doc.status);
        console.log("Data Status:", JSON.parse(doc.data).status);
        console.log("Full doc:", doc);
    } catch (e) {
        console.error(e);
    }
}
main();
