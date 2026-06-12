import { useCallback, useRef } from 'react';

/**
 * Prevents double-click / rapid-fire submissions on async actions.
 *
 * Uses a ref-based Map of in-flight promises keyed by an arbitrary string.
 * If the same key is invoked while a previous call is still running, the
 * previous promise is returned instead of starting a new one.
 *
 * This is the recommended pattern over local `isLoading` state when:
 *  - The same component has multiple independent async actions (e.g. rows in a table)
 *  - The handler is called from keyboard (Enter) AND click events
 *  - You want a single spinner source of truth
 *
 * @example
 *   const { run } = useSingleClick();
 *   const handleSave = () => run('save-lead', async () => { await save(); });
 */
export function useSingleClick() {
  // Use a ref so adding/removing entries never triggers a re-render.
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());

  const run = useCallback(
    <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      const existing = inFlightRef.current.get(key);
      if (existing) {
        // Re-cast — caller doesn't need to know it's the same promise
        return existing as Promise<T>;
      }

      const promise = (async () => {
        try {
          return await fn();
        } finally {
          // Always clear the entry, even on error
          inFlightRef.current.delete(key);
        }
      })();

      inFlightRef.current.set(key, promise);
      return promise;
    },
    [],
  );

  const isRunning = useCallback((key: string): boolean => {
    return inFlightRef.current.has(key);
  }, []);

  return { run, isRunning };
}
