'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/auth-context';
import { getReportingCalendarAction } from '@/app/actions/target-month-bounds';
import { resolveReportingPeriod } from '@/lib/utils/reporting-period';
import { useEffect, useState } from 'react';
import { getCurrentEasternIsoDate, easternWallTimeToIso } from '@/lib/utils/eastern-date';

export const REPORTING_CALENDAR_QUERY_KEY = ['reporting-calendar'] as const;
export function useCurrentMonthBounds() {
  const { user } = useAuth();
  const [today, setToday] = useState(getCurrentEasternIsoDate);
  useEffect(() => {
    // One local midnight transition, not a poll or database request. Handles 23/25-hour days.
    const end = easternWallTimeToIso(`${today}T23:59`).replace(':00.000Z', ':59.999Z');
    const timer = setTimeout(() => setToday(getCurrentEasternIsoDate()), Math.max(1, Date.parse(end) - Date.now() + 25));
    const visible = () => { if (document.visibilityState === 'visible') setToday(getCurrentEasternIsoDate()); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [today]);
  const query = useQuery({ queryKey: [...REPORTING_CALENDAR_QUERY_KEY, user?.$id], queryFn: getReportingCalendarAction,
    enabled: !!user, staleTime: 5 * 60_000, refetchInterval: false, refetchOnWindowFocus: false,
    refetchOnReconnect: false, refetchOnMount: true, retry: false });
  const period = resolveReportingPeriod(query.data || []);
  if (query.error) throw new Error('Could not load CRM reporting dates. Reload this page to try again.');
  return { ...period, windows: query.data || [], isLoading: query.isPending, error: query.error };
}
