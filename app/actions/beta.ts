'use server';

import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Query } from 'node-appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { betaAccessDocumentId, LINKEDIN_CONVERSATIONS_FEATURE, listBetaFeatureAccess } from '@/lib/server/beta-feature-access';
import { canJoinLinkedinConversations, hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';
import type { User } from '@/lib/types';

// Preserve the access read for older CRM tabs during the general release.
export async function getMyLinkedinHelperAccessAction() {
  return canUseLinkedinExtension(await getAuthenticatedUserDoc());
}

// Stale admin tabs must not change retired beta settings or send access notifications.
export async function listLinkedinHelperBetaUsersAction() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' || actor.isActive === false) throw new Error('Only active admins can manage beta access.');
  throw new Error('LinkedIn Helper is available to all eligible users. Beta access settings have been retired.');
}

export async function setLinkedinHelperBetaAccessAction(_userId: string, _enabled: boolean) {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' || actor.isActive === false) throw new Error('Only active admins can manage beta access.');
  throw new Error('LinkedIn Helper is available to all eligible users. Beta access settings have been retired.');
}

export async function getMyLinkedinConversationAccessAction() {
  const actor = await getAuthenticatedUserDoc();
  return hasLinkedinConversationAccess((await createAdminClient()).databases, actor);
}

async function getBetaAdminDatabases() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' || actor.isActive === false) throw new Error('Only active admins can manage beta access.');
  return (await createAdminClient()).databases;
}

export async function listLinkedinConversationBetaUsersAction() {
  const databases = await getBetaAdminDatabases();
  databases.clearReadCacheForCollection(COLLECTIONS.USERS);
  const [users, enabled] = await Promise.all([
    listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('role', ['agent', 'team_lead', 'admin']), Query.select(['$id', 'name', 'role', 'department', 'isActive'])] }),
    listBetaFeatureAccess(databases, LINKEDIN_CONVERSATIONS_FEATURE),
  ]);
  return users.filter(user => canJoinLinkedinConversations(user) || enabled.has(user.$id))
    .map(user => ({ id: user.$id, name: user.name, role: user.role,
      eligible: canJoinLinkedinConversations(user), enabled: enabled.has(user.$id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function setLinkedinConversationBetaAccessAction(userId: string, enabled: boolean) {
  const databases = await getBetaAdminDatabases();
  if (typeof userId !== 'string' || !userId || userId.length > 36 || typeof enabled !== 'boolean') throw new Error('Invalid beta access setting.');
  databases.clearReadCacheForCollection(COLLECTIONS.USERS);
  const user = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId) as unknown as User;
  if (enabled && !canJoinLinkedinConversations(user)) throw new Error('This user is ineligible for LinkedIn Conversations.');
  const feature = LINKEDIN_CONVERSATIONS_FEATURE;
  const id = betaAccessDocumentId(userId, feature);
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, { enabled });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    try {
      await databases.createDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, { userId, feature, enabled }, []);
    } catch (conflict) {
      if ((conflict as { code?: number }).code !== 409) throw conflict;
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, id, { enabled });
    }
  }
}
