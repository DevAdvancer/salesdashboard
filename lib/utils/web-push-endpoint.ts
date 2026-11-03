/**
 * The server POSTs to whatever endpoint a browser registers, so only the real
 * browser push services are accepted (Chrome/Edge via FCM, Firefox, Safari,
 * legacy Edge via WNS). Anything else could make the server call arbitrary URLs.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];
export const MAX_PUSH_ENDPOINT_LENGTH = 2048;

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  return PUSH_SERVICE_HOSTS.some(host => host.test(url.hostname.toLowerCase()));
}

/** Base64url keys from PushSubscription.toJSON(). */
export function isPushKey(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[A-Za-z0-9_-]+=*$/.test(value);
}
