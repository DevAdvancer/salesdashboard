import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient, createSessionClient } from "@/lib/server/appwrite";
import { bumpRequestCount } from "@/lib/server/appwrite-request-meter";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type { User } from "@/lib/types";

import { cache } from "react";
import { memoizeCrmRequest } from '@/lib/server/crm-request-context';
const accountRequestKey = Symbol('crm-account');
const userRequestKey = Symbol('crm-user');

// Share the checked profile with account/user helpers in this request. Keeping
// the two together also avoids another database read in actions outside the
// explicit AsyncLocalStorage wrapper; React owns their request scope.
const getAuthenticatedContext = cache(() => memoizeCrmRequest(accountRequestKey, async () => {
  let authenticated;
  let checkedUser: User | undefined;
  if (process.env.CRM_ACCESS_ENFORCEMENT === 'true') {
    const { assertCrmAccess } = await import('@/lib/server/crm-access');
    const identity = await assertCrmAccess();
    if (!identity) throw new Error('Unauthorized');
    authenticated = identity.account;
    checkedUser = identity.user;
    // Keep authorization reads fresh without performing a second native account lookup.
    (await createAdminClient()).databases.clearReadCacheForCollection?.(COLLECTIONS.USERS);
  } else {
    const { account } = await createSessionClient();
    // `/v1/account` bypasses the database read cache.
    bumpRequestCount();
    authenticated = await account.get();
  }
  return { account: authenticated, checkedUser };
}));

export const getAuthenticatedAccount = cache(async () => (await getAuthenticatedContext()).account);

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

export const getAuthenticatedUserDoc = cache(() => memoizeCrmRequest(userRequestKey, async (): Promise<User> => {
  const { account, checkedUser } = await getAuthenticatedContext();
  const doc = await (async () => {
    if (checkedUser) {
      if (checkedUser.$id !== account.$id) throw new Error('Unauthorized');
      return checkedUser;
    }
    try {
      const { databases } = await createAdminClient();
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
}));
