type Callable = (...args: unknown[]) => unknown;

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const READ_METHODS = new Set(["getDocument", "listDocuments"]);
const WRITE_PREFIXES = ["create", "update", "delete"];

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

function stableKey(namespace: string, method: string, args: unknown[]) {
  return `${namespace}:${method}:${JSON.stringify(args)}`;
}

export function createReadThroughDatabases<T extends object>(
  source: T,
  options: number | AppwriteReadCacheOptions = DEFAULT_TTL_MS
): T & { clearReadCache: () => void } {
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

  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === "clearReadCache") {
        return clearReadCache;
      }

      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function" || typeof prop !== "string") {
        return original;
      }

      const method = original as Callable;

      if (READ_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const key = stableKey(namespace, prop, args);
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

      if (WRITE_PREFIXES.some((prefix) => prop.startsWith(prefix))) {
        return (...args: unknown[]) =>
          Promise.resolve(method.apply(target, args)).finally(clearReadCache);
      }

      return method.bind(target);
    },
  }) as T & { clearReadCache: () => void };
}
