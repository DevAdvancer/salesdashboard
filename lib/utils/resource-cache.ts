/**
 * Lightweight in-memory TTL cache for frequently-read service results.
 *
 * Several pages (leads, users, dashboard, etc.) re-fetch the same
 * branches/users lists on every visit. This cache turns repeat fetches
 * within the TTL window into a Map lookup, cutting latency and
 * Appwrite round-trips.
 *
 * Notes:
 *  - Pure in-memory, browser-only. Cleared on page refresh.
 *  - Cache key must include all parameters that change the result.
 *  - Call `clearCache("branches:")` (or similar) from CRUD paths so
 *    created/updated/deleted records show up immediately.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Run `loader` and cache the result for `ttlMs` under `key`. Subsequent
 * calls within the TTL return the cached value without hitting the
 * underlying service.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Invalidate cached entries. Pass a `prefix` to drop only matching keys
 * (e.g. after a user-management CRUD action: `clearCache("users:")`).
 * Omit the prefix to clear everything.
 */
export function clearCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
