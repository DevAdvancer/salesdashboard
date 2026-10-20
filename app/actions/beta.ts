'use server';

import { Query } from 'node-appwrite';
import { z } from 'zod';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { betaAccessDocumentId, hasLinkedinHelperAccess, LINKEDIN_HELPER_FEATURE, listLinkedinHelperAccess } from '@/lib/server/beta-feature-access';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { logAction } from '@/lib/services/audit-service';
import type { User } from '@/lib/types';

async function freshActor() {
  const { databases } = await createAdminClient();
  databases.clearReadCacheForCollection(COLLECTIONS.USERS);
  return { actor: await getAuthenticatedUserDoc(), databases };
}

async function assertManager() {
  const context = await freshActor();
  if (context.actor.role !== 'admin' || context.actor.isActive === false) {
    throw new Error('Only active admins can manage beta access.');
  }
  return context;
}

export async function getMyLinkedinHelperAccessAction() {
  const { actor, databases } = await freshActor();
  return canUseLinkedinExtension(actor) && await hasLinkedinHelperAccess(databases, actor.$id);
}

export async function listLinkedinHelperBetaUsersAction() {
  const { databases } = await assertManager();
  const [users, granted] = await Promise.all([
    listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.select(['$id', 'name', 'email', 'role', 'department', 'isActive']), Query.orderAsc('name')] }),
    listLinkedinHelperAccess(databases),
  ]);
  // Include previously selected users even after deactivation so the admin can revoke them.
  return users.filter(user => canUseLinkedinExtension(user) || granted.has(user.$id)).map(user => ({
    id: user.$id, name: user.name, email: user.email, role: user.role,
    eligible: canUseLinkedinExtension(user), enabled: granted.has(user.$id),
  }));
}

export async function setLinkedinHelperBetaAccessAction(userId: string, enabled: boolean) {
  const { actor, databases } = await assertManager();
  z.string().min(1).max(36).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).parse(userId);
  z.boolean().parse(enabled);
  if (enabled) {
    const user = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    if (!canUseLinkedinExtension(user as unknown as User)) throw new Error('Select an active Sales user with LinkedIn Requests access.');
  }
  const id = betaAccessDocumentId(userId);
  const data = { feature: LINKEDIN_HELPER_FEATURE, userId, enabled };
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, data);
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    try {
      // Empty permissions: only the authorized server actions manage grants.
      await databases.createDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, data, []);
    } catch (createError) {
      if ((createError as { code?: number }).code !== 409) throw createError;
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, data);
    }
  }
  databases.clearReadCacheForCollection(COLLECTIONS.BETA_FEATURE_ACCESS);
  await logAction({ action: 'SETTINGS_UPDATE', actorId: actor.$id, actorName: actor.name,
    targetId: userId, targetType: 'beta_feature_access', metadata: { feature: LINKEDIN_HELPER_FEATURE, enabled } });
  return { enabled };
}
