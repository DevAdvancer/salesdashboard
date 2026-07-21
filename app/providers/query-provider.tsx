"use client";

import { QueryClientProvider, useIsFetching, useIsMutating } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/queries/client";
import { startLoaderSimulation, finishLoaderSimulation } from "@/utils/loader";
import { useEffect } from "react";

function GlobalFetchingIndicator() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();

  useEffect(() => {
    if (isFetching > 0 || isMutating > 0) {
      startLoaderSimulation();
    } else {
      finishLoaderSimulation();
    }
  }, [isFetching, isMutating]);

  return null;
}

interface QueryProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the app with TanStack Query's provider. Put this inside
 * <AuthProvider> so we can clear the cache on logout.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalFetchingIndicator />
      {children}
      {process.env.NODE_ENV !== "production" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}