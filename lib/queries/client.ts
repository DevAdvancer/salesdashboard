"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Build a fresh QueryClient with the defaults appropriate for this CRM.
 *
 *  - staleTime: 2 hr — matches the underlying appwrite-read-cache TTL. A
 *    page that returns within the window renders instantly from cache.
 *  - gcTime: 4 hr — keeps query data alive through a couple of return
 *    visits and a tab restore, even past staleTime. Once a query is
 *    garbage-collected the next mount will refetch (one round-trip per
 *    returned page, not per navigation).
 *  - refetchOnWindowFocus: false — we don't want surprise refreshes while
 *    a user is typing in a filter input or just looking at another window.
 *  - refetchOnReconnect: false — a brief network blip should not trigger
 *    a cascade of refetches on every active page.
 *  - refetchOnMount: false — page remounts hit the cache instead of
 *    re-issuing identical requests. Mutations are the primary cache
 *    invalidation path; a manual refresh button is the escape hatch.
 *  - structuralSharing: true (default) — TanStack reuses object refs when
 *    data is structurally identical, so consumers don't re-render
 *    spuriously across page transitions.
 *  - retry: 1 — one network retry is enough; further retries are noisy.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 60 * 1000,
        gcTime: 4 * 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchInterval: 30 * 60 * 1000,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

/**
 * Returns the singleton QueryClient for the browser, or a fresh per-request
 * one on the server (RSC isolation). This is the pattern recommended by the
 * TanStack docs for Next.js App Router.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server: always a fresh client so RSC requests don't share state.
    return makeQueryClient();
  }
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}

export function clearBrowserQueryClient(): void {
  if (typeof window === "undefined") {
    return;
  }

  getQueryClient().clear();
}
