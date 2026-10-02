import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import { Client, Databases, Permission, Role } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { createAdminClient } from "../lib/server/appwrite";

async function main() {
  const { databases } = await createAdminClient();

  try {
    await databases.getCollection(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS);
    console.log("Collection exists:", COLLECTIONS.TARGET_MONTH_BOUNDS);
  } catch {
    console.log("Creating collection:", COLLECTIONS.TARGET_MONTH_BOUNDS);
    await databases.createCollection(
      DATABASE_ID,
      COLLECTIONS.TARGET_MONTH_BOUNDS,
      "Target Month Bounds",
      [
        Permission.read(Role.users()),
        Permission.write(Role.team("admin")),
        Permission.write(Role.team("developer")),
      ]
    );

    await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, "monthKey", 20, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, "leadsFromIso", 20, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, "leadsToIso", 20, true);
    console.log("Attributes created.");
  }
}

main().catch(console.error);
