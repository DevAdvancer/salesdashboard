"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

export function EstClock() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    // Initial format
    const updateClock = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!time) {
    return <div className="h-9 w-24 bg-muted animate-pulse rounded-md" />;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 shadow-sm">
      <Clock className="w-4 h-4" />
      <span className="text-sm font-semibold tracking-wide whitespace-nowrap">
        {time} EST
      </span>
    </div>
  );
}
