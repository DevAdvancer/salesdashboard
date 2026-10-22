/** Share concurrent work only. Settled values and failures are never cached. */
export function createInFlightGroup(limit = 512) {
  const pending = new Map<string, Promise<unknown>>();
  return function inFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    if (pending.size >= limit) return load();
    const promise = Promise.resolve().then(load);
    pending.set(key, promise);
    const clear = () => { if (pending.get(key) === promise) pending.delete(key); };
    void promise.then(clear, clear);
    return promise;
  };
}
