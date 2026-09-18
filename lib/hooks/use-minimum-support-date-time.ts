import { useEffect, useState } from "react";

import { getMinimumSupportDateTime } from "@/lib/utils/support-schedule";

export function useMinimumSupportDateTime(active: boolean): string {
  const [minimum, setMinimum] = useState(() => getMinimumSupportDateTime());

  useEffect(() => {
    if (!active) return;

    const refresh = () => setMinimum(getMinimumSupportDateTime());
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(interval);
  }, [active]);

  return minimum;
}
