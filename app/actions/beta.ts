'use server';

import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { createAdminClient } from '@/lib/server/appwrite';
import { hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';

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

async function rejectConversationBetaAccess() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' || actor.isActive === false) throw new Error('Only active admins can manage beta access.');
  throw new Error('LinkedIn Conversations is available to all eligible users. Beta settings have been retired.');
}

export async function listLinkedinConversationBetaUsersAction() {
  await rejectConversationBetaAccess();
}

export async function setLinkedinConversationBetaAccessAction(_userId: string, _enabled: boolean) {
  await rejectConversationBetaAccess();
}
