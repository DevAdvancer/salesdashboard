/**
 * Per-scope counter for outbound Appwrite HTTP calls.
 *
 * Why this exists: without it, "did request volume actually drop?" can only be
 * answered from the Appwrite console usage graph, which is coarse and lags. A
 * counter carried on the async context lets a single entry point (a cron run, a
 * server action) report exactly how many network calls it made, right next to
 * the work it did.
 *
 * This module is pure instrumentation. It never changes caching, querying, or
 * auth behaviour, and every function is safe to call outside a scope.
 *
 * Why `node:async_hooks` is resolved at runtime instead of imported: this
 * module is reached from lib/utils/appwrite-read-cache.ts, which is bundled for
 * the browser as well as the server. A static import of a Node builtin would
 * make the client build fail to resolve it. Where AsyncLocalStorage does not
 * exist the meter degrades to a no-op, which is the correct failure mode for
 * instrumentation.
 */

interface MeterScope {
  count: number;
}

// The slice of the AsyncLocalStorage surface this module needs.
interface AsyncScopeStorage {
  getStore(): MeterScope | undefined;
  run<R>(store: MeterScope, fn: () => R): R;
}

// `undefined` means "not looked up yet", `null` means "looked up, unavailable".
let storage: AsyncScopeStorage | null | undefined;

function resolveStorage(): AsyncScopeStorage | null {
  if (storage !== undefined) return storage;
  storage = null;

  type StorageConstructor = new () => AsyncScopeStorage;
  let constructor: StorageConstructor | null = null;

  if (
    typeof process !== "undefined" &&
    typeof process.getBuiltinModule === "function"
  ) {
    // Node 22.3+: reaches a builtin without giving the bundler an import
    // specifier to follow.
    try {
      const asyncHooks = process.getBuiltinModule("node:async_hooks");
      constructor =
        (asyncHooks?.AsyncLocalStorage as unknown as StorageConstructor) ?? null;
    } catch {
      constructor = null;
    }
  }

  if (!constructor) {
    // The Next.js edge runtime exposes AsyncLocalStorage as a global instead.
    constructor =
      ((globalThis as { AsyncLocalStorage?: unknown })
        .AsyncLocalStorage as unknown as StorageConstructor) ?? null;
  }

  if (constructor) {
    storage = new constructor();
  }

  return storage;
}

/**
 * Increment the active counting scope. No-op outside a scope, so call sites do
 * not need to know whether they are running under a meter.
 */
export function bumpRequestCount(): void {
  const scope = resolveStorage()?.getStore();
  if (scope) {
    scope.count += 1;
  }
}

/**
 * Read the active counting scope. Returns 0 outside a scope.
 */
export function getRequestCount(): number {
  return resolveStorage()?.getStore()?.count ?? 0;
}

/**
 * Run `fn` in a fresh counting scope and report how many Appwrite calls it
 * made. Nested calls do not open a second isolated scope: they keep writing
 * into the outermost store so its total covers everything, and report only the
 * slice they contributed themselves.
 */
export async function withRequestMeter<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; count: number }> {
  const scopeStorage = resolveStorage();
  if (!scopeStorage) {
    return { result: await fn(), count: 0 };
  }

  const outer = scopeStorage.getStore();
  if (outer) {
    const before = outer.count;
    const result = await fn();
    return { result, count: outer.count - before };
  }

  const scope: MeterScope = { count: 0 };
  const result = await scopeStorage.run(scope, () => Promise.resolve(fn()));
  return { result, count: scope.count };
}
