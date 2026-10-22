"use client";

import { useState } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import { getQueryClient } from "@/lib/queries/client";

interface QueryProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the app with TanStack Query's provider. Put this inside
 * <AuthProvider> so we can clear the cache on logout.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const queryClient = getQueryClient();
  const [persister] = useState(() => createAsyncStoragePersister({
    storage: {
      getItem: async key => {
        const value = typeof window === 'undefined' ? undefined : await get(key);
        return value === undefined ? null : value;
      },
      setItem: (key, value) => typeof window === 'undefined' ? Promise.resolve() : set(key, value),
      removeItem: key => typeof window === 'undefined' ? Promise.resolve() : del(key),
    },
  }));

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister }}
    >
      {children}
      {process.env.NODE_ENV !== "production" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </PersistQueryClientProvider>
  );
}
