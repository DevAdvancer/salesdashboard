"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/components/ui/use-toast";
import {
  getMyAttendanceToggleStateAction,
  markMyselfPresentAction,
} from "@/app/actions/attendance";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";

type ToggleState = Awaited<ReturnType<typeof getMyAttendanceToggleStateAction>>;

const REFRESH_MS = 60 * 1000;
const ATTENDANCE_TOGGLE_SCOPE = "attendance:self-toggle";
const FORCE_REFRESH_COOLDOWN_MS = 5 * 1000;

export function AttendanceSelfToggle() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<ToggleState | null>(null);
  const [loading, setLoading] = useState(false);
  const lastForcedRefreshAt = useRef(0);

  const visible = user?.role === "agent" || user?.role === "team_lead" || user?.role === "lead_generation";

  const refresh = useCallback(async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (!user || !visible) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible" && forceRefresh) {
      return;
    }

    if (forceRefresh) {
      const now = Date.now();
      if (now - lastForcedRefreshAt.current < FORCE_REFRESH_COOLDOWN_MS) {
        return;
      }
      lastForcedRefreshAt.current = now;
    }

    try {
      const next = await cacheClientRead(
        ATTENDANCE_TOGGLE_SCOPE,
        [user.$id],
        () =>
          getMyAttendanceToggleStateAction({
            currentUserId: user.$id,
          }),
        { ttlMs: REFRESH_MS, forceRefresh },
      );
      setState(next);
    } catch {
      setState(null);
    }
  }, [user, visible]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user || !visible) return;
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refresh({ forceRefresh: true });
    }, REFRESH_MS);
    const refreshOnFocus = () => {
      void refresh({ forceRefresh: true });
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh, user, visible]);

  const view = useMemo(() => {
    const present = state?.present === true;
    const windowStatus = state?.windowStatus ?? "closed";
    const canMarkPresent = state?.canMarkPresent === true;

    if (present) {
      return {
        label: "Present",
        variant: "outline" as const,
        disabled: true,
        className: "text-green-600 border-green-600",
      };
    }

    if (canMarkPresent) {
      return {
        label: "Mark Present",
        variant: "outline" as const,
        disabled: false,
        className: "text-green-600 border-green-600",
      };
    }

    const label = windowStatus === "before" ? "Absent (opens 9 ET)" : "Absent";

    return {
      label,
      variant: "outline" as const,
      disabled: true,
      className: "text-red-600 border-red-600",
    };
  }, [state?.canMarkPresent, state?.present, state?.windowStatus]);

  if (!user || !visible) return null;

  const handleClick = async () => {
    if (!user) return;
    setLoading(true);
    try {
      await markMyselfPresentAction({ currentUserId: user.$id });
      clearClientReadCache(ATTENDANCE_TOGGLE_SCOPE);
      toast({ title: "Success", description: "Marked as present." });
      await refresh({ forceRefresh: true });
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to mark present",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={view.variant}
      disabled={view.disabled}
      loading={loading}
      className={view.className}
      onClick={handleClick}>
      {view.label}
    </Button>
  );
}
