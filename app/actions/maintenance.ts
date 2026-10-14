"use server";

import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { getMaintenanceStatus, isMaintenanceManager, MAINTENANCE_SETTINGS_ID } from "@/lib/server/maintenance";
import { easternWallTimeToIso } from "@/lib/utils/eastern-date";

async function assertManager() {
  const actor = await getAuthenticatedUserDoc();
  if (!isMaintenanceManager(actor)) throw new Error("Unauthorized");
  return actor;
}

export async function getMaintenanceSettingsAction() {
  await assertManager();
  return getMaintenanceStatus();
}

export async function setMaintenanceModeAction(input: { enabled: boolean; endsAtEastern?: string }) {
  const actor = await assertManager();
  const endsAt = input.enabled ? easternWallTimeToIso(input.endsAtEastern || "") : null;
  if (endsAt && Date.parse(endsAt) <= Date.now()) {
    throw new Error("Choose an end time in the future.");
  }
  const { databases, users } = await createAdminClient();
  const before = await getMaintenanceStatus(databases);
  const config = JSON.stringify({ enabled: input.enabled, endsAt, updatedBy: actor.$id,
    updatedAt: new Date().toISOString() });
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.MAINTENANCE_SETTINGS,
      MAINTENANCE_SETTINGS_ID, { config });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    await databases.createDocument(DATABASE_ID, COLLECTIONS.MAINTENANCE_SETTINGS,
      MAINTENANCE_SETTINGS_ID, { config });
  }
  databases.clearReadCacheForCollection?.(COLLECTIONS.MAINTENANCE_SETTINGS);
  let signedOut = 0;
  const failedUserIds: string[] = [];
  if (input.enabled && !before.active) {
    const docs = await listAllDocuments<{ $id: string }>({ databases,
      databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.select(["$id"]), Query.orderAsc("$id")] });
    for (const doc of docs) {
      if (doc.$id === actor.$id) continue;
      try { await users.deleteSessions(doc.$id); signedOut += 1; }
      catch { failedUserIds.push(doc.$id); }
    }
  }
  return { ...(await getMaintenanceStatus(databases)), signedOut, failedUserIds };
}
