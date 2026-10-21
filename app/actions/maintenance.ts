"use server";

import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
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
  const { databases } = await createAdminClient();
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
  // Appwrite sessions span sites. Revoking them globally also disconnects localhost.
  // The live UI and server access guard enforce maintenance per request instead.
  return { ...(await getMaintenanceStatus(databases)), signedOut:0, failedUserIds:[] as string[] };
}
