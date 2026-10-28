'use server';
import { getAuthenticatedAccount } from '@/lib/server/current-user';
import { createAdminClient } from '@/lib/server/appwrite';
export async function hasAcknowledgedSecurityNotice() {
  const actor = await getAuthenticatedAccount();
  return actor.prefs?.crmSecurityNoticeVersion === 'native-mfa-v1';
}
export async function acknowledgeSecurityNotice() {
  const actor = await getAuthenticatedAccount();
  const { users } = await createAdminClient();
  const prefs = await users.getPrefs(actor.$id);
  await users.updatePrefs(actor.$id, { ...prefs, crmSecurityNoticeVersion: 'native-mfa-v1', crmSecurityNoticeAcceptedAt: new Date().toISOString() });
}
