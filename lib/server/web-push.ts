import { createHash } from 'node:crypto';
import { Query, type Databases } from 'node-appwrite';
import webpush from 'web-push';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { isAllowedPushEndpoint } from '@/lib/utils/web-push-endpoint';

export type PushPayload = { title: string; body: string; url: string; tag: string };
type SubscriptionDoc = { $id: string; userId: string; endpoint: string; p256dh: string; auth: string };

export function webPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
let vapidReady = false;
function configureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  vapidReady = true;
}

/** One document per browser endpoint, so a browser that changes user moves its subscription. */
export function pushSubscriptionDocumentId(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

/** Push to every browser this user allowed. Never throws; dead subscriptions are removed.
 * Reads bypass the admin read cache so a browser that just subscribed is found. */
export async function sendPushToUser(userId: string, payload: PushPayload, db?: Databases) {
  if (!webPushConfigured()) return { sent: 0 };
  let rows: SubscriptionDoc[];
  let databases: Databases;
  try {
    databases = db ?? (await import('@/lib/server/crm-access')).securityDatabase();
    const result = await databases.listDocuments(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS,
      [Query.equal('userId', userId), Query.limit(20)]);
    rows = result.documents as unknown as SubscriptionDoc[];
  } catch { return { sent: 0 }; } // Collection not provisioned yet, or Appwrite unavailable.
  configureVapid();
  // The push service stores at most ~4 KB; keep the visible text short.
  const body = JSON.stringify({ ...payload, title: payload.title.slice(0, 120), body: payload.body.slice(0, 300) });
  const results = await Promise.all(rows.map(async row => {
    if (!isAllowedPushEndpoint(row.endpoint)) return false;
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body,
        { TTL: 6 * 60 * 60, urgency: 'normal', timeout: 5_000 });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404/410: the browser unsubscribed or the subscription expired.
      if (status === 404 || status === 410) {
        await databases.deleteDocument(DATABASE_ID, COLLECTIONS.PUSH_SUBSCRIPTIONS, row.$id).catch(() => {});
      }
      return false;
    }
  }));
  return { sent: results.filter(Boolean).length };
}

/** Send after the response where Next allows it, so notifying never slows the user's request. */
export function queuePushToUser(userId: string, payload: PushPayload) {
  if (!webPushConfigured()) return;
  const task = () => sendPushToUser(userId, payload).then(() => undefined).catch(() => undefined);
  // Loaded lazily: next/server needs the web Request global, absent in scripts and some tests.
  void import('next/server').then(({ after }) => {
    try { after(task); } catch { void task(); } // Outside a request (scripts, tests).
  }, () => task());
}
