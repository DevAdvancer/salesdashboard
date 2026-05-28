const DEFAULT_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlight = new Map<string, { promise: Promise<unknown>; forceRefresh: boolean }>();
let cacheEpoch = 0;

interface ClientReadCacheOptions {
  ttlMs?: number;
  forceRefresh?: boolean;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function stableKey(scope: string, args: unknown[]) {
  return `${scope}:${stableSerialize(args)}`;
}

export function clearClientReadCache(scopePrefix?: string) {
  cacheEpoch += 1;

  if (!scopePrefix) {
    cache.clear();
    inFlight.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(scopePrefix)) {
      cache.delete(key);
    }
  }

  for (const key of inFlight.keys()) {
    if (key.startsWith(scopePrefix)) {
      inFlight.delete(key);
    }
  }
}

export function cacheClientRead<T>(
  scope: string,
  args: unknown[],
  read: () => Promise<T>,
  options: number | ClientReadCacheOptions = DEFAULT_TTL_MS
): Promise<T> {
  const resolvedOptions =
    typeof options === "number" ? { ttlMs: options } : options;
  const ttlMs = resolvedOptions.ttlMs ?? DEFAULT_TTL_MS;
  const key = stableKey(scope, args);
  const now = Date.now();
  const cached = cache.get(key);

  if (!resolvedOptions.forceRefresh && cached && cached.expiresAt > now) {
    return Promise.resolve(cached.value as T);
  }

  const existingRequest = inFlight.get(key);
  if (existingRequest) {
    if (!resolvedOptions.forceRefresh || existingRequest.forceRefresh) {
      return existingRequest.promise as Promise<T>;
    }

    cacheEpoch += 1;
    cache.delete(key);
    inFlight.delete(key);
  }

  const requestEpoch = cacheEpoch;
  const request = read()
    .then((value) => {
      if (ttlMs > 0 && requestEpoch === cacheEpoch) {
        cache.set(key, { expiresAt: Date.now() + ttlMs, value });
      }
      return value;
    })
    .finally(() => {
      const currentRequest = inFlight.get(key);
      if (currentRequest?.promise === request) {
        inFlight.delete(key);
      }
    });

  inFlight.set(key, {
    promise: request,
    forceRefresh: Boolean(resolvedOptions.forceRefresh),
  });
  return request;
}
