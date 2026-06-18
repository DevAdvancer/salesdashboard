'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { databases } from '@/lib/appwrite';
import { clearClientReadCache } from '@/lib/utils/client-read-cache';
import { clearCache } from '@/lib/utils/resource-cache';

export type ManualRefreshScope = 'all' | 'page';

/**
 * Manual refresh hook — escape hatch from the page-sticky cache.
 *
 * Default behavior (`scope: 'page'`): invalidate every TanStack query and
 * let the underlying read-through cache serve from memory wherever the
 * entry is still within its 2-hour window. No server round-trip when the
 * cache is warm; one round-trip per affected collection otherwise.
 *
 * `'all'`: clear every layer (appwrite-read-cache, client-read-cache,
 * resource-cache) and refetch. Use this when the user explicitly wants a
 * hard refresh — e.g. after returning from a long break and the cached
 * data is now days old.
 */
export function useManualRefresh(options: { scope?: ManualRefreshScope } = {}) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scope: ManualRefreshScope = options.scope ?? 'page';

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (scope === 'all') {
        databases.clearReadCache?.();
        clearClientReadCache();
        clearCache();
      }
      await queryClient.invalidateQueries();
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, scope]);

  return { refresh, isRefreshing };
}
