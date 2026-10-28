"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { databases } from "@/lib/appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { useRealtimeCollection } from "@/lib/hooks/use-realtime-collection";

// Refetches started shortly after a change signal skip the server's per-instance
// read cache, because the write may have landed on a different instance.
const FRESH_READ_WINDOW_MS = 5000;
let freshReadsUntil = 0;

export function wantsFreshLeadRead(): boolean {
  return Date.now() < freshReadsUntil;
}

/**
 * Keep visible lead lists current without timers: the shared change check
 * (one marker read per minute) reports a lead change, and only then are the
 * active list and count queries refetched.
 */
export function useLeadChangeRefresh(enabled = true): void {
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    freshReadsUntil = Date.now() + FRESH_READ_WINDOW_MS;
    databases.clearReadCacheForCollection(COLLECTIONS.LEADS);
    void queryClient.invalidateQueries({ queryKey: ["leads", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["leads", "counts"] });
  }, [queryClient]);
  useRealtimeCollection(COLLECTIONS.LEADS, refresh, { enabled });
}
