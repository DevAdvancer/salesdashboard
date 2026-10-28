import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage<Map<unknown, Promise<unknown>>>();
export function hasCrmRequestContext() { return context.getStore() !== undefined; }

/** One HTTP operation only. Use on endpoints that do not change activation
 * or native MFA. Nothing survives the response or crosses request cookies. */
export function withCrmRequestContext<T>(operation: () => Promise<T>): Promise<T> {
  return context.run(new Map(), operation);
}

export function memoizeCrmRequest<T>(key: unknown, operation: () => Promise<T>): Promise<T> {
  const store = context.getStore();
  if (!store) return operation();
  const existing = store.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(operation);
  store.set(key, pending);
  return pending;
}
