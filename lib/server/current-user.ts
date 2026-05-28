import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient, createSessionClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type { User } from "@/lib/types";

export async function getAuthenticatedAccount() {
  const { account } = await createSessionClient();
  return account.get();
}

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

export async function getAuthenticatedUserDoc(): Promise<User> {
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
    managerId: doc.managerId || null,
    managerIds: doc.managerIds || [],
    assistantManagerId: doc.assistantManagerId || null,
    assistantManagerIds: doc.assistantManagerIds || [],
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  } as User;
}
