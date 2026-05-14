type Callable = (...args: unknown[]) => unknown;

const DEFAULT_TTL_MS = 30_000;
const READ_METHODS = new Set(["getDocument", "listDocuments"]);
const WRITE_PREFIXES = ["create", "update", "delete"];

function stableKey(method: string, args: unknown[]) {
  return `${method}:${JSON.stringify(args)}`;
}

export function createReadThroughDatabases<T extends object>(
  source: T,
  ttlMs = DEFAULT_TTL_MS
): T & { clearReadCache: () => void } {
  const cache = new Map<string, { expiresAt: number; value: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();

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
          const key = stableKey(prop, args);
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
