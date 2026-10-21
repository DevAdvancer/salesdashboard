import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient, createSessionClient } from "@/lib/server/appwrite";
import { bumpRequestCount } from "@/lib/server/appwrite-request-meter";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type { User } from "@/lib/types";
import { getRequestMaintenanceStatus, isMaintenanceManager } from "@/lib/server/maintenance";

import { cache } from "react";

export const getAuthenticatedAccount = cache(async () => {
  const { account } = await createSessionClient();
  // `/v1/account` never passes through the read cache, so without this the
  // meter would miss the one request every authenticated server entry point
  // makes.
  bumpRequestCount();
  const authenticated = await account.get();
  const maintenance = await getRequestMaintenanceStatus();
  if (maintenance.active && !isMaintenanceManager(authenticated)) {
    throw new Error("CRM maintenance is in progress. Try again after the scheduled end time.");
  }
  return authenticated;
});

export async function assertAuthenticatedUserId(userId: string | null | undefined) {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const account = await getAuthenticatedAccount();
  if (account.$id !== userId) {
    throw new Error("Unauthorized");
  }

  return account;
}

export const getAuthenticatedUserDoc = cache(async (): Promise<User> => {
  const account = await getAuthenticatedAccount();
  const { databases } = await createAdminClient();
  const doc = await (async () => {
    try {
      return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, account.$id);
    } catch (error) {
      throw new Error(getAppwriteErrorMessage(error));
    }
  })();

  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    // `department` drives the resume/sales split — dropping it here made every
    // server action that gates on `actor.department` (e.g. call requests) treat
    // resume users as sales, denying resume TLs/agents access to their pages.
    department: doc.department || "sales",
    isActive: doc.isActive,
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    primaryBranchId: typeof doc.primaryBranchId === 'string' ? doc.primaryBranchId : null,
    branchId: doc.branchId || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  } as User;
});
