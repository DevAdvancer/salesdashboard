import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminTargetBoundsForm } from '@/components/target-report/admin-target-bounds-form';
import { getTargetMonthBound, saveTargetMonthBound } from '@/app/actions/target-month-bounds';
jest.mock('@/app/actions/target-month-bounds', () => ({ getTargetMonthBound: jest.fn(), saveTargetMonthBound: jest.fn() }));
jest.mock('@/lib/services/target-report-service', () => ({ clearTargetReportCache: jest.fn() }));
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
test('uses custom calendar buttons for the inclusive global reporting window', async () => {
  (getTargetMonthBound as jest.Mock).mockResolvedValue({ monthKey: '2026-10', leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02' });
  (saveTargetMonthBound as jest.Mock).mockResolvedValue({ ok: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = jest.fn();
  const result = render(<QueryClientProvider client={client}><AdminTargetBoundsForm monthKey="2026-10" onSaved={saved} /></QueryClientProvider>);
  try {
    const from = await screen.findByLabelText('Start date (Eastern)');
    const to = screen.getByLabelText('End date (Eastern)');
    expect(from.tagName).toBe('BUTTON'); expect(to.tagName).toBe('BUTTON');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(from);
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Save Window' }));
    await waitFor(() => expect(saveTargetMonthBound).toHaveBeenCalledWith('2026-10', '2026-10-02', '2026-11-02'));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  } finally { result.unmount(); client.clear(); }
});
