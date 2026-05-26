const DEFAULT_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

function stableKey(scope: string, args: unknown[]) {
  return `${scope}:${JSON.stringify(args)}`;
}

export function clearClientReadCache() {
  cache.clear();
  inFlight.clear();
}

export function cacheClientRead<T>(
  scope: string,
  args: unknown[],
  read: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const key = stableKey(scope, args);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.value as T);
  }

  const existingRequest = inFlight.get(key);
  if (existingRequest) {
    return existingRequest as Promise<T>;
  }

  const request = read()
    .then((value) => {
      cache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
