"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Build a fresh QueryClient with the defaults appropriate for this CRM.
 *  - staleTime: 5 min — matches the server-side read-through cache TTL
 *  - gcTime: 30 min — pages can come back without an immediate refetch
 *  - refetchOnWindowFocus: false — we don't want surprise refreshes while
 *    a user is typing in a filter input
 *  - retry: 1 — one network retry is enough; further retries are noisy
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
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
