import { useState, useEffect } from 'react';
import { getTargetMonthBound } from '@/app/actions/target-month-bounds';
import { getMonthStartEst, getMonthEndEst } from '@/lib/utils/est-date';

export function useCurrentMonthBounds() {
  const [bounds, setBounds] = useState<{ leadsFromIso: string; leadsToIso: string; isLoading: boolean }>({
    leadsFromIso: getMonthStartEst(),
    leadsToIso: getMonthEndEst(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const today = new Date();
    const estParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(today);
    const year = estParts.find(p => p.type === 'year')?.value;
    const month = estParts.find(p => p.type === 'month')?.value;
    const monthKey = `${year}-${month}`;

    getTargetMonthBound(monthKey).then((res) => {
      if (!cancelled) {
        setBounds({
          leadsFromIso: res?.leadsFromIso ?? getMonthStartEst(),
          leadsToIso: res?.leadsToIso ?? getMonthEndEst(),
          isLoading: false,
        });
      }
    }).catch((err) => {
      console.error("Error fetching current month bounds", err);
      if (!cancelled) {
        setBounds(prev => ({ ...prev, isLoading: false }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return bounds;
}
