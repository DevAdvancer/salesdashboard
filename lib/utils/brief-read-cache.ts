/** Bounded, process-local cache for advisory data, never authorization decisions. */
export function createBriefReadCache<T>(ttlMs: number, maxEntries: number) {
  const entries = new Map<string, { expiresAt: number; promise: Promise<T> }>();
  return {
    clear() { entries.clear(); },
    read(key: string, load: () => Promise<T>): Promise<T> {
      const current = entries.get(key);
      if (current && current.expiresAt > Date.now()) return current.promise;
      entries.delete(key);
      for (const [existingKey, entry] of entries) {
        if (entry.expiresAt <= Date.now()) entries.delete(existingKey);
      }
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      const entry = { expiresAt: Date.now() + ttlMs, promise: Promise.resolve().then(load) };
      entries.set(key, entry);
      // A failed read must be retried, and an older failure cannot remove its replacement.
      void entry.promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
      return entry.promise;
    },
  };
}
