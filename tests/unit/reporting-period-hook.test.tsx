import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCurrentMonthBounds } from '@/lib/hooks/use-current-month-bounds';
import { getReportingCalendarAction } from '@/app/actions/target-month-bounds';
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { $id: 'user' } }) }));
jest.mock('@/app/actions/target-month-bounds', () => ({ getReportingCalendarAction: jest.fn() }));
const windows = [{ monthKey: '2026-10', leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02' }, { monthKey: '2026-11', leadsFromIso: '2026-11-03', leadsToIso: '2026-11-30' }];
function View({ id }: { id: string }) { const period = useCurrentMonthBounds(); return <span data-testid={id}>{period.isLoading ? 'Loading' : period.monthKey}</span>; }
test('CRM consumers share one settings request and midnight changes months without polling', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-03T04:59:59Z'));
  (getReportingCalendarAction as jest.Mock).mockResolvedValue(windows);
  const client = new QueryClient({ defaultOptions: { queries: { refetchInterval: 1000, retry: false } } });
  const result = render(<QueryClientProvider client={client}><View id="dashboard" /><View id="target" /></QueryClientProvider>);
  try {
    await act(async () => { jest.advanceTimersByTime(50); });
    await act(async () => { jest.advanceTimersByTime(50); });
    expect(screen.getByTestId('dashboard')).toHaveTextContent('2026-10');
    expect(screen.getByTestId('target')).toHaveTextContent('2026-10');
    expect(getReportingCalendarAction).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByTestId('dashboard')).toHaveTextContent('2026-11');
    expect(screen.getByTestId('target')).toHaveTextContent('2026-11');
    expect(getReportingCalendarAction).toHaveBeenCalledTimes(1);
  } finally { result.unmount(); client.clear(); jest.useRealTimers(); }
});
