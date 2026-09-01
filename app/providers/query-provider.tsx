"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
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
  const [persister, setPersister] = useState<any>(null);

  useEffect(() => {
    // Only create the persister on the client side since idb-keyval relies on window
    if (typeof window !== "undefined") {
      setPersister(
        createAsyncStoragePersister({
          storage: {
            getItem: async (key) => {
              const value = await get(key);
              return value === undefined ? null : value;
            },
            setItem: set,
            removeItem: del,
          },
        })
      );
    }
  }, []);

  if (!persister) {
    // Fallback for SSR or initial mount before persister is ready
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV !== "production" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    );
  }

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