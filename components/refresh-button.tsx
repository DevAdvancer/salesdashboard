'use client';

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useManualRefresh, type ManualRefreshScope } from "@/lib/hooks/use-manual-refresh";
import { cn } from "@/lib/utils";

export interface RefreshButtonProps {
  /** "page" (default) invalidates TanStack queries and refetches; the
   *  underlying read cache still serves warm hits. "all" wipes every
   *  cache layer before refetching. */
  scope?: ManualRefreshScope;
  /** Visible label. Defaults to nothing — icon only. */
  label?: string;
  className?: string;
}

/**
 * Small manual refresh control — opt-in for page headers.
 *
 * The default caching strategy keeps data sticky across navigation
 * (page-to-page navigation does not refetch) and only invalidates the
 * affected collection on writes. This button is the escape hatch when
 * a user wants to be sure the page reflects the latest data.
 */
export function RefreshButton({
  scope = "page",
  label,
  className,
}: RefreshButtonProps) {
  const { refresh, isRefreshing } = useManualRefresh({ scope });

  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? "sm" : "icon"}
      onClick={() => {
        refresh();
      }}
      disabled={isRefreshing}
      title={
        scope === "all"
          ? "Refresh — clears all caches and refetches data"
          : "Refresh — refetches the current page"
      }
      aria-label="Refresh"
      className={cn("shrink-0", className)}
    >
      <RefreshCw
        className={cn("h-4 w-4", isRefreshing && "animate-spin")}
        aria-hidden="true"
      />
      {label ? <span>{label}</span> : null}
    </Button>
  );
}
