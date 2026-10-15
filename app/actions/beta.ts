'use server';

import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';

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
