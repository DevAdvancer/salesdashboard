import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { aggregateAgentStatsForDates } from "@/lib/server/stats-aggregator";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";

async function backfill() {
  const { databases } = await createAdminClient();

  // 1. Ensure the assignedLeadCount attribute exists
  console.log("Checking for assignedLeadCount attribute...");
  try {
    const coll = await databases.getCollection(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS);
    const hasAttr = coll.attributes.some((a: any) => a.key === "assignedLeadCount");
    if (!hasAttr) {
      console.log("Creating assignedLeadCount attribute...");
      await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "assignedLeadCount", false, 0, 9999999, 0);
      
      console.log("Waiting for attribute to be available...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log("assignedLeadCount already exists.");
    }
  } catch (error) {
    console.error("Failed to check/create attribute", error);
  }

  // 2. Build date keys for August 2026 up to today
  const dateKeys: string[] = [];
  const today = getCurrentEasternIsoDate().slice(0, 10);
  
  for (let i = 1; i <= 31; i++) {
    const day = i.toString().padStart(2, "0");
    const dateKey = `2026-08-${day}`;
    dateKeys.push(dateKey);
    if (dateKey === today) break;
  }

  console.log(`Backfilling for dates:`, dateKeys);

  // 3. Run backfill
  await aggregateAgentStatsForDates(dateKeys);
  console.log("Backfill complete!");
}

backfill().catch(console.error);
