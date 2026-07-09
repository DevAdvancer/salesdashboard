/**
 * Setup script for all collections including previous_followups_payments
 * Run: bun run setup:appwrite
 */

import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function setup() {
  console.log("Setting up collections...");
  const { databases } = await createAdminClient();

  // Previous Followups Payments
  try {
    await databases.getCollection(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
    console.log("Collection exists:", COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
  } catch (error: any) {
    if (error?.code === 404) {
      console.log("Creating collection:", COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
      await databases.createCollection(DATABASE_ID, ID.unique(), {
        name: "Previous Followups Payments",
      });
    } else {
      throw error;
    }
  }

  console.log("Setup complete!");
}

setup().catch(console.error);