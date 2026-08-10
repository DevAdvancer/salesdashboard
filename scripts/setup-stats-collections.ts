/**
 * Setup script for daily stats caching collections
 * Run: bun run setup:stats:dry
 * Run: bun run setup:stats
 */

import { ID } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

const isDryRun = process.argv.includes(":dry") || process.argv.includes("--dry") || process.argv.includes("setup:stats:dry");

async function setup() {
  console.log(`Setting up stats collections... (Dry run: ${isDryRun})`);
  const { databases } = await createAdminClient();

  // 1. LINKEDIN_DAILY_STATS
  try {
    await databases.getCollection(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS);
    console.log("Collection exists:", COLLECTIONS.LINKEDIN_DAILY_STATS);
  } catch (error: any) {
    if (error?.code === 404) {
      console.log("Creating collection:", COLLECTIONS.LINKEDIN_DAILY_STATS);
      if (!isDryRun) {
        await databases.createCollection(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "LinkedIn Daily Stats");
        
        console.log("Creating attributes for", COLLECTIONS.LINKEDIN_DAILY_STATS);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "dateKey", 20, true);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "accountId", 50, true);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "agentId", 50, true);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "teamLeadId", 50, false);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "company", 255, false);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "idName", 255, false);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "accountType", 50, false);
        
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "sent", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "accepted", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "leadsGenerated", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "closures", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "coldCalls", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "notAccepted", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, "withdrawn", false, 0, 9999999, 0);
        
        // Let's create an index if possible. 
        // Appwrite requires waiting for attributes to be created before creating index, but for simplicity here we might skip or do it manually, or wait.
        // It's safer to wait, but attributes create asynchronously in the background in Appwrite.
      }
    } else {
      throw error;
    }
  }

  // 2. AGENT_DAILY_STATS
  try {
    await databases.getCollection(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS);
    console.log("Collection exists:", COLLECTIONS.AGENT_DAILY_STATS);
  } catch (error: any) {
    if (error?.code === 404) {
      console.log("Creating collection:", COLLECTIONS.AGENT_DAILY_STATS);
      if (!isDryRun) {
        await databases.createCollection(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "Agent Daily Stats");
        
        console.log("Creating attributes for", COLLECTIONS.AGENT_DAILY_STATS);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "dateKey", 20, true);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "agentId", 50, true);
        await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "teamLeadId", 50, false);
        
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "leadsGenerated", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "assignedLeadCount", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "referralsGenerated", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "coldCallsGenerated", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "leadsClosed", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "notInterestedMarked", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "callsScheduled", false, 0, 9999999, 0);
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "followupsScheduled", false, 0, 9999999, 0);
        
        await databases.createFloatAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "upfrontRevenue", false, 0, 999999999, 0);
        await databases.createFloatAttribute(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, "technicalUpfrontRevenue", false, 0, 999999999, 0);
      }
    } else {
      throw error;
    }
  }

  console.log("Setup complete!");
}

setup().catch(console.error);
