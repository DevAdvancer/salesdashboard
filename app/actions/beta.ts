'use server';

import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { betaAccessDocumentId, hasLinkedinHelperAccess, LINKEDIN_HELPER_FEATURE, listLinkedinHelperAccess } from '@/lib/server/beta-feature-access';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import type { User } from '@/lib/types';

async function assertBetaAdmin() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' || actor.isActive === false) throw new Error('Only active admins can manage beta access.');
  return actor;
}

export async function getMyLinkedinHelperAccessAction() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.isActive === false || (actor.department ?? 'sales') !== 'sales' ||
      !isRoleEligibleForComponent('linkedin-requests', actor.role)) return false;
  const { databases } = await createAdminClient();
  return hasLinkedinHelperAccess(databases, actor.$id);
}

export async function listLinkedinHelperBetaUsersAction() {
  await assertBetaAdmin();
  const { databases } = await createAdminClient();
  databases.clearReadCacheForCollection(COLLECTIONS.USERS);
  const [users, allowed] = await Promise.all([
    listAllDocuments<Pick<User, '$id' | 'name' | 'email' | 'role' | 'department' | 'isActive'>>({
      databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.select(['$id', 'name', 'email', 'role', 'department', 'isActive'])],
    }),
    listLinkedinHelperAccess(databases),
  ]);
  return users.filter(user => user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-requests', user.role))
    .map(user => ({ id: user.$id, name: user.name, email: user.email, role: user.role, enabled: allowed.has(user.$id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function setLinkedinHelperBetaAccessAction(userId: string, enabled: boolean) {
  await assertBetaAdmin();
  if (typeof userId !== 'string' || !userId || typeof enabled !== 'boolean') throw new Error('Invalid beta access change.');
  const { databases } = await createAdminClient();
  databases.clearReadCacheForCollection(COLLECTIONS.USERS);
  const user = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  if (user.isActive === false || (user.department ?? 'sales') !== 'sales' ||
      !isRoleEligibleForComponent('linkedin-requests', user.role)) throw new Error('This user cannot use LinkedIn Requests.');
  const id = betaAccessDocumentId(userId);
  const data = { feature: LINKEDIN_HELPER_FEATURE, userId, enabled };
  const wasEnabled = await hasLinkedinHelperAccess(databases, userId);
  databases.clearReadCacheForCollection(COLLECTIONS.BETA_FEATURE_ACCESS);
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, data);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 404) throw error;
    await databases.createDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, data);
  }
  databases.clearReadCacheForCollection(COLLECTIONS.BETA_FEATURE_ACCESS);
  if (enabled && !wasEnabled) {
    await createNotificationsForRecipients(databases, [userId], {
      type: 'LINKEDIN_HELPER_ACCESS',
      title: 'LinkedIn Helper access granted',
      body: 'You now have access to the LinkedIn Helper beta. Open LinkedIn Requests to install the extension and get started.',
      targetId: userId,
      targetType: 'linkedin_requests',
    });
  }
  return { userId, enabled };
}
