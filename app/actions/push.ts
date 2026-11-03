'use server';

import { cookies } from 'next/headers';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { securityDatabase } from '@/lib/server/crm-access';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { pushSubscriptionDocumentId } from '@/lib/server/web-push';
import { CRM_IMPERSONATION_COOKIE } from '@/lib/utils/crm-impersonation';
import { isAllowedPushEndpoint, isPushKey } from '@/lib/utils/web-push-endpoint';

type BrowserSubscription = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

async function assertOwnSession() {
  // An operator's browser must never receive the impersonated user's pushes.
  if ((await cookies()).get(CRM_IMPERSONATION_COOKIE)?.value) throw new Error('Stop impersonating to manage notifications.');
  return getAuthenticatedUserDoc();
}

/** Register (or move to this user) the current browser's push subscription. */
export async function savePushSubscriptionAction(subscription: BrowserSubscription) {
  const user = await assertOwnSession();
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!isAllowedPushEndpoint(endpoint) || !isPushKey(p256dh, 256) || !isPushKey(auth, 64)) {
    throw new Error('This browser returned an unsupported push subscription.');
  }
  const db = securityDatabase();
  const id = pushSubscriptionDocumentId(endpoint);
  const data = { userId: user.$id, endpoint, p256dh, auth };
  try {
    await db.updateDocument(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS, id, data);
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    // Server-only collection: no document permissions.
    await db.createDocument(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS, id, data, []);
  }
  return { success: true };
}

/** Forget this browser for the signed-in user, e.g. on sign-out. */
export async function removePushSubscriptionAction(endpoint: string) {
  const user = await assertOwnSession();
  if (!isAllowedPushEndpoint(endpoint)) return { success: false };
  const db = securityDatabase();
  const id = pushSubscriptionDocumentId(endpoint);
  try {
    const row = await db.getDocument(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS, id);
    if (row.userId === user.$id) await db.deleteDocument(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS, id);
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
  return { success: true };
}
