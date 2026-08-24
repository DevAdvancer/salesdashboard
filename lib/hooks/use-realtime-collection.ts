"use client";

import React, { useEffect, useRef } from "react";
import { client, DATABASE_ID } from "@/lib/appwrite";

/**
 * Subscribe to Appwrite realtime events for one collection and run a
 * callback whenever any document in it is created, updated, or deleted.
 *
 * Events are debounced: a bulk import or a rapid burst of writes fires
 * many events in <100ms, and without coalescing we'd run the callback
 * (usually a refetch) once per event. `debounceMs` (default 250ms) is
 * short enough to feel live, long enough to collapse a burst into one
 * refresh.
 *
 * This mirrors the inline subscription pattern already used on the users,
 * hierarchy, and notification-bell views — extracted so the leads list and
 * dashboard can share it. The callback is held in a ref so callers can pass
 * an inline closure without re-subscribing on every render; the channel
 * only re-subscribes when `collectionId` or `enabled` changes.
 */
export function useRealtimeCollection(
  collectionId: string | undefined,
  onChange: () => void,
  options: { enabled?: boolean; debounceMs?: number } = {},
): void {
  const { enabled = true, debounceMs = 250 } = options;
  const onChangeRef = useRef(onChange);
  
  // Use layout effect to keep the ref updated without mutating during render
  typeof window !== 'undefined'
    ? // eslint-disable-next-line react-hooks/rules-of-hooks
      React.useLayoutEffect(() => { onChangeRef.current = onChange; }, [onChange])
    : // eslint-disable-next-line react-hooks/rules-of-hooks
      React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!enabled || !collectionId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onChangeRef.current();
      }, debounceMs);
    };

    const unsubscribe = client.subscribe(
      `databases.${DATABASE_ID}.collections.${collectionId}.documents`,
      scheduleChange,
    );

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [collectionId, enabled, debounceMs]);
}
