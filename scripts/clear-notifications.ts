import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { Query } from "node-appwrite";

async function clearNotifications() {
  const { databases } = await createAdminClient();
  
  console.log("Fetching all notifications...");
  
  const notifications = await listAllDocuments<{ $id: string }>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.NOTIFICATIONS,
    queries: [Query.select(['$id'])],
  });

  console.log(`Found ${notifications.length} notifications to delete.`);

  let deletedCount = 0;
  const batchSize = 50;

  for (let i = 0; i < notifications.length; i += batchSize) {
    const batch = notifications.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (notification) => {
      try {
        await databases.deleteDocument(
          DATABASE_ID,
          COLLECTIONS.NOTIFICATIONS,
          notification.$id
        );
      } catch (error) {
        console.error(`Failed to delete notification ${notification.$id}:`, error);
      }
    }));
    
    deletedCount += batch.length;
    console.log(`Deleted ${deletedCount}/${notifications.length} notifications...`);
    // Add a small delay to prevent rate limit / connection refused
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`Finished clearing notifications. Deleted ${deletedCount} in total.`);
}

clearNotifications().catch(console.error);
