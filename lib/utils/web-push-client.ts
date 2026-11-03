const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const SAVED_KEY = 'crm.push.saved';
/** Re-save occasionally so a server-side cleanup never silently drops this browser. */
const RESAVE_MS = 7 * 24 * 60 * 60 * 1000;

export function webPushSupported() {
  return typeof window !== 'undefined' && Boolean(PUBLIC_KEY) && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;
}

function applicationServerKey() {
  const padded = `${PUBLIC_KEY}${'='.repeat((4 - (PUBLIC_KEY.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
function readSaved() { try { return localStorage.getItem(SAVED_KEY) || ''; } catch { return ''; } }
function writeSaved(value: string) { try { if (value) localStorage.setItem(SAVED_KEY, value); else localStorage.removeItem(SAVED_KEY); } catch { /* Restricted storage. */ } }

/**
 * Subscribe this browser for the signed-in user once permission is granted.
 * Saves to the server only when the user or endpoint changed (or weekly), so
 * normal page loads add no server call. Returns whether push is active.
 */
export async function enableWebPush(userId: string): Promise<boolean> {
  if (!webPushSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey() });
  }
  const json = subscription.toJSON();
  const [savedFor, savedEndpoint, savedAt] = readSaved().split('|');
  if (savedFor === userId && savedEndpoint === json.endpoint && Date.now() - Number(savedAt) < RESAVE_MS) return true;
  const { savePushSubscriptionAction } = await import('@/app/actions/push');
  await savePushSubscriptionAction({ endpoint: json.endpoint, keys: json.keys });
  writeSaved(`${userId}|${json.endpoint}|${Date.now()}`);
  return true;
}

/** On sign-out: stop this browser receiving the previous user's notifications. */
export async function disableWebPush() {
  writeSaved('');
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  // Server removal needs the session, so it runs before sign-out; unsubscribing
  // always works and makes any leftover record fail and be cleaned up.
  await import('@/app/actions/push').then(({ removePushSubscriptionAction }) => removePushSubscriptionAction(subscription.endpoint)).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}
