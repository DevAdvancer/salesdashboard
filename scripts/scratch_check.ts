import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function main() {
  const { databases } = await createAdminClient();
  const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, []);
  if (docs.documents.length > 0) {
    console.log(Object.keys(docs.documents[0]));
    console.log("notificationsEnabled:", docs.documents[0].notificationsEnabled);
    console.log("notificationEmails:", docs.documents[0].notificationEmails);
  }
}

main().catch(console.error);
