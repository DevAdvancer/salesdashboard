/**
 * Process-local reuse of a validated native session for a few seconds. Every proxy,
 * page, action and API call otherwise waits on 2-3 Appwrite round trips, and Fluid
 * compute bills provisioned memory for all of that waiting. MFA expiry is still
 * evaluated on every request from the cached session fields; revocation and
 * deactivation reach other instances within this window. CRM_IDENTITY_CACHE_MS=0
 * restores a live check on every request.
 */
const MAX_ENTRIES = 1_000;
const entries = new Map<string, { expiresAt: number; value: unknown }>();

export function identityCacheMs() {
  const value = Number(process.env.CRM_IDENTITY_CACHE_MS ?? 30_000);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 60_000) : 0;
}
export function readCachedIdentity<T>(key: string, now = Date.now()): T | undefined {
  if (identityCacheMs() <= 0) return undefined;
  const entry = entries.get(key);
  if (entry && entry.expiresAt > now) return entry.value as T;
  if (entry) entries.delete(key);
  return undefined;
}
/** Keeps a success only, never past `notAfter` (the native session expiry). */
export function storeCachedIdentity(key: string, value: unknown, notAfter: number, now = Date.now()) {
  const ttl = identityCacheMs();
  const expiresAt = Math.min(now + ttl, Number.isFinite(notAfter) ? notAfter : now + ttl);
  if (ttl <= 0 || expiresAt <= now) return;
  for (const [existing, entry] of entries) if (entry.expiresAt <= now) entries.delete(existing);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, { expiresAt, value });
}
/** Drop reused sessions on this instance, e.g. after a deactivation or sign-out. */
export function clearCrmIdentityCache() { entries.clear(); }
