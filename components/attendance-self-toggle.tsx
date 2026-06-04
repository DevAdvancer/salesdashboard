"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/components/ui/use-toast";
import {
  getMyAttendanceToggleStateAction,
  markMyselfPresentAction,
} from "@/app/actions/attendance";

type ToggleState = Awaited<ReturnType<typeof getMyAttendanceToggleStateAction>>;

const REFRESH_MS = 60 * 1000;

export function AttendanceSelfToggle() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<ToggleState | null>(null);
  const [loading, setLoading] = useState(false);

  const visible = user?.role === "agent" || user?.role === "team_lead" || user?.role === "lead_generation";

  const refresh = useCallback(async () => {
    if (!user || !visible) return;
    try {
      const next = await getMyAttendanceToggleStateAction({
        currentUserId: user.$id,
      });
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
      void refresh();
    }, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
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
      toast({ title: "Success", description: "Marked as present." });
      await refresh();
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
    <div className="fixed right-16 top-3 z-50 sm:right-20 lg:right-24">
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
    </div>
  );
}
