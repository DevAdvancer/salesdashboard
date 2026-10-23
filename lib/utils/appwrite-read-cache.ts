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
 *    key, including the database and the exact serialized query arguments.
 *  - The in-flight Map collapses concurrent identical calls into one
 *    network round-trip — already a CPU saver, kept as-is.
 *  - `inFlight` is also pruned when we clear the cache, so a request that
 *    races with an invalidation doesn't write stale data back into the
 *    cleared slot.
 */

import { bumpRequestCount } from "@/lib/server/appwrite-request-meter";
import logger from "@/lib/logger";

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
  databaseId: string,
  collectionId: string,
  tail: unknown[],
): string {
  // tail is everything after collectionId in the args array. For
  // listDocuments that's queries. For getDocument that's [docId, queries].
  // Retain the exact query identity: short hashes can collide across scopes.
  const tailKey = tail.length === 0 ? "" : stableSerialize(tail);
  return `${namespace}:${databaseId}:${method}:${collectionId}:${tailKey}`;
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
): T & { uncachedReads: Pick<T, Extract<keyof T, 'getDocument' | 'listDocuments'>>; clearReadCache: () => void; clearReadCacheForCollection: (id: string) => void } {
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
      if (prop === 'uncachedReads') return Object.fromEntries([...READ_METHODS].map(name => [name, (...args: unknown[]) => {
        bumpRequestCount();
        return (Reflect.get(target, name) as Callable).apply(target, args);
      }]));
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
          if (!collectionId || collectionId === "attendance" || collectionId === process.env.NEXT_PUBLIC_APPWRITE_ATTENDANCE_COLLECTION_ID) {
            // Unknown shape or highly volatile collection — fall through to the underlying SDK without
            // caching rather than silently miss.
            return Promise.resolve(method.apply(target, args));
          }

          // Tail is everything after collectionId. For getDocument that's
          // [docId, queries?]. For listDocuments that's [queries?].
          const tail = args.slice(2);
          const key = buildReadKey(namespace, prop, String(args[0]), collectionId, tail);
          const now = Date.now();
          const cached = cache.get(key);

          if (cached && cached.expiresAt > now) {
            logger.debug({
              type: 'database_read',
              method: prop,
              collectionId,
              durationMs: 0,
              namespace,
              cacheHit: true
            }, `Appwrite Read: ${prop} (Cache Hit)`);
            return Promise.resolve(cached.value);
          }

          const existingRequest = inFlight.get(key);
          if (existingRequest) {
            return existingRequest;
          }

          // Nothing cached and nothing in flight: this is the single point
          // where a read turns into a real Appwrite HTTP call, so it is the
          // only place the meter should count. Hits and in-flight joins above
          // cost nothing on the wire and must stay uncounted.
          bumpRequestCount();

          const start = Date.now();
          const request = Promise.resolve(method.apply(target, args))
            .then((value) => {
              if (inFlight.get(key) === request) cache.set(key, { expiresAt: Date.now() + ttlMs, value });
              logger.debug({
                type: 'database_read',
                method: prop,
                collectionId,
                durationMs: Date.now() - start,
                namespace,
                cacheHit: false
              }, `Appwrite Read: ${prop}`);
              return value;
            })
            .catch((error) => {
              logger.error({
                error,
                type: 'database_read',
                method: prop,
                collectionId,
                durationMs: Date.now() - start,
                namespace
              }, `Appwrite Read Error: ${prop}`);
              throw error;
            })
            .finally(() => {
              if (inFlight.get(key) === request) inFlight.delete(key);
            });

          inFlight.set(key, request);
          return request;
        };
      }

      if (WRITE_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const collectionId = extractCollectionId(prop, args);
          const start = Date.now();
          const promise = Promise.resolve(method.apply(target, args));

          promise.then(() => {
            logger.debug({
              type: 'database_write',
              method: prop,
              collectionId,
              durationMs: Date.now() - start,
              namespace
            }, `Appwrite Write: ${prop}`);
          }).catch((error) => {
            logger.error({
              error,
              type: 'database_write',
              method: prop,
              collectionId,
              durationMs: Date.now() - start,
              namespace
            }, `Appwrite Write Error: ${prop}`);
          });

          // Surgical invalidation: only the affected collection drops out
          // of the cache. This applies to creates, updates, and deletes —
          // a create still needs to drop lists/gets of the same collection
          // so the new doc shows up; an update needs to drop the
          // affected doc + its containing lists.
          // Return this chain so a rejected write cannot leave an unhandled
          // rejection from a detached finally callback.
          return promise.finally(() => {
            if (collectionId) clearReadCacheForCollection(collectionId);
            else clearReadCache();
          });
        };
      }

      return method.bind(target);
    },
  }) as T & { uncachedReads: Pick<T, Extract<keyof T, 'getDocument' | 'listDocuments'>>; clearReadCache: () => void; clearReadCacheForCollection: (id: string) => void };
}
