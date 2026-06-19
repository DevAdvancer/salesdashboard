/**
 * Test stub for `next/cache`. The real module transitively loads
 * `next/src/server/web/spec-extension/request.ts` which uses
 * `class extends Request` and breaks under Jest's jsdom environment.
 * Production behavior is preserved because Next.js wires the real
 * `unstable_cache` and `revalidateTag` for Server Components and
 * Server Actions at runtime.
 */

type AnyFn = (...args: unknown[]) => unknown;

export const unstable_cache: <T extends AnyFn>(
  fn: T,
  keyParts?: string[],
  options?: { revalidate?: number | false; tags?: string[] },
) => T = (fn) => fn;

export const revalidateTag: (tag: string, profile?: unknown) => void = () => {
  // no-op in tests
};

export const revalidatePath: (path: string, type?: 'page' | 'layout') => void =
  () => {
    // no-op in tests
  };
