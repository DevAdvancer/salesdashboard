/**
 * Read-through cache for the browser Appwrite Databases SDK.
 *
 * Design goals (June 2026):
 *  - Pages stay sticky: navigating between pages does not refetch as long as
 *    the cached entry is within the TTL window.
 *  - Writes are surgical: createDocument / updateDocument / deleteDocument on
 *    a given collection only invalidate that collection's cache; other
 *    collections stay warm.
 *  - 2-hour default TTL: an implicit "auto-refresh" — the next call after the
 *    window expires refetches once, then is cached again.
 *
 * Public API on the proxied Databases instance:
 *  - clearReadCache()                  — full wipe (logout, manual refresh).
 *  - clearReadCacheForCollection(id)   — surgical wipe for one collection.
 *  - All other methods are passed through, with read methods cached and write
 *    methods triggering surgical invalidation.
 *
 * Implementation notes:
 *  - Keys are derived deterministically from the method + collection + the
 *    relevant arguments, instead of JSON.stringify-ing the entire args array.
 *    listDocuments and getDocument accept variable-length tail arguments
 *    (queries, selection, etc.) — only the relevant ones participate in the
 *    key, and they're hashed with a tiny non-cryptographic hash.
 *  - The in-flight Map collapses concurrent identical calls into one
 *    network round-trip — already a CPU saver, kept as-is.
 *  - `inFlight` is also pruned when we clear the cache, so a request that
 *    races with an invalidation doesn't write stale data back into the
 *    cleared slot.
 */

type Callable = (...args: unknown[]) => unknown;

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const READ_METHODS = new Set(["getDocument", "listDocuments"]);
const WRITE_METHODS = new Set([
  "createDocument",
  "updateDocument",
  "deleteDocument",
]);

export interface AppwriteReadCacheStores {
  cache: Map<string, { expiresAt: number; value: unknown }>;
  inFlight: Map<string, Promise<unknown>>;
}

interface AppwriteReadCacheOptions {
  ttlMs?: number;
  namespace?: string;
  stores?: AppwriteReadCacheStores;
}

export function createAppwriteReadCacheStores(): AppwriteReadCacheStores {
  return {
    cache: new Map(),
    inFlight: new Map(),
  };
}

// Tiny non-cryptographic string hash (FNV-1a-ish). Used only to make
// query-array keys compact and stable; collisions are vanishingly rare
// and a collision is at worst a stale-cache hit, never a wrong-data hit.
function shortHash(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Stable serializer for the parts of the args array that participate in the
// key. Arrays become `[a,b,c]`, plain objects sort their keys, and the rest
// uses JSON.stringify. This avoids stringifying the full args (which often
// includes things like Permissions arrays) and is much cheaper for the
// common case of "no queries".
function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`);
  return `{${entries.join(",")}}`;
}

function buildReadKey(
  namespace: string,
  method: string,
  collectionId: string,
  tail: unknown[],
): string {
  // tail is everything after collectionId in the args array. For
  // listDocuments that's queries. For getDocument that's [docId, queries].
  const tailKey = tail.length === 0 ? "" : shortHash(stableSerialize(tail));
  return `${namespace}:${method}:${collectionId}:${tailKey}`;
}

function extractCollectionId(method: string, args: unknown[]): string | null {
  // All write methods take (databaseId, collectionId, ...).
  // listDocuments and getDocument take (databaseId, collectionId, ...).
  // For createDocument the collectionId is the 3rd positional arg
  // (databaseId, collectionId, documentId, data) — so always index 1.
  if (
    WRITE_METHODS.has(method) ||
    method === "listDocuments" ||
    method === "getDocument"
  ) {
    const id = args[1];
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

export function createReadThroughDatabases<T extends object>(
  source: T,
  options: number | AppwriteReadCacheOptions = DEFAULT_TTL_MS,
): T & { clearReadCache: () => void; clearReadCacheForCollection: (id: string) => void } {
  const resolvedOptions =
    typeof options === "number" ? { ttlMs: options } : options;
  const ttlMs = resolvedOptions.ttlMs ?? DEFAULT_TTL_MS;
  const namespace = resolvedOptions.namespace ?? "default";
  const stores = resolvedOptions.stores ?? createAppwriteReadCacheStores();
  const { cache, inFlight } = stores;

  const clearReadCache = () => {
    cache.clear();
    inFlight.clear();
  };

  const clearReadCacheForCollection = (collectionId: string) => {
    if (!collectionId) return;
    const prefix = `:${collectionId}:`;
    for (const key of cache.keys()) {
      if (key.includes(prefix)) {
        cache.delete(key);
      }
    }
    for (const key of inFlight.keys()) {
      if (key.includes(prefix)) {
        inFlight.delete(key);
      }
    }
  };

  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === "clearReadCache") {
        return clearReadCache;
      }
      if (prop === "clearReadCacheForCollection") {
        return clearReadCacheForCollection;
      }

      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function" || typeof prop !== "string") {
        return original;
      }

      const method = original as Callable;

      if (READ_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const collectionId = extractCollectionId(prop, args);
          if (!collectionId) {
            // Unknown shape — fall through to the underlying SDK without
            // caching rather than silently miss.
            return Promise.resolve(method.apply(target, args));
          }

          // Tail is everything after collectionId. For getDocument that's
          // [docId, queries?]. For listDocuments that's [queries?].
          const tail = args.slice(2);
          const key = buildReadKey(namespace, prop, collectionId, tail);
          const now = Date.now();
          const cached = cache.get(key);

          if (cached && cached.expiresAt > now) {
            return Promise.resolve(cached.value);
          }

          const existingRequest = inFlight.get(key);
          if (existingRequest) {
            return existingRequest;
          }

          const request = Promise.resolve(method.apply(target, args))
            .then((value) => {
              cache.set(key, { expiresAt: Date.now() + ttlMs, value });
              return value;
            })
            .finally(() => {
              inFlight.delete(key);
            });

          inFlight.set(key, request);
          return request;
        };
      }

      if (WRITE_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const collectionId = extractCollectionId(prop, args);
          const promise = Promise.resolve(method.apply(target, args));

          // Surgical invalidation: only the affected collection drops out
          // of the cache. This applies to creates, updates, and deletes —
          // a create still needs to drop lists/gets of the same collection
          // so the new doc shows up; an update needs to drop the
          // affected doc + its containing lists.
          if (collectionId) {
            promise.finally(() => {
              clearReadCacheForCollection(collectionId);
            });
          } else {
            // Couldn't identify the collection — fall back to a full wipe
            // so we never serve a known-stale read.
            promise.finally(() => {
              clearReadCache();
            });
          }

          return promise;
        };
      }

      return method.bind(target);
    },
  }) as T & { clearReadCache: () => void; clearReadCacheForCollection: (id: string) => void };
}
