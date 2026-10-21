import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WeeklyReportDashboard } from '@/components/reports/weekly-report-dashboard';
import type { User } from '@/lib/types';
const mockReport = jest.fn();
jest.mock('@/lib/services/weekly-report-service', () => ({ getWeeklyReport: (...args: unknown[]) => mockReport(...args) }));
jest.mock('@/lib/utils/est-date', () => ({ getCurrentWeekEst: () => ({ from: '2026-10-19', to: '2026-10-25' }) }));
jest.mock('@/components/ui/date-picker', () => ({ DateRangePicker: ({ onChange }: any) =>
  <button onClick={() => onChange({ from: '2026-07-01', to: '2026-10-21' })}>Change report dates</button> }));
const user = { $id: 'agent', name: 'Agent', role: 'agent' } as User;
const metrics = { calls: 0, leads: 5, followups: 0, closures: 0, coldCalls: 0, notInterested: 3,
  linkedinLeads: 4, linkedinNotInterested: 2, upfront: 0, technicalUpfront: 0,
  kpi: { daily: [], daysMet: 0, daysMissed: 0, totalDays: 0 } };

test('defaults to the current week, retains custom dates and removes the July shortcut', async () => {
  mockReport.mockResolvedValue({ teams: [{ teamLead: null, members: [{ user, metrics }], totals: metrics }] });
  render(<WeeklyReportDashboard user={user} />);
  expect(await screen.findByText('LinkedIn Leads')).toBeInTheDocument();
  expect(screen.getByText('LinkedIn Not Interested')).toBeInTheDocument();
  expect(mockReport).toHaveBeenLastCalledWith('agent', '2026-10-19T00:00:00.000Z', '2026-10-25T23:59:59.999Z');
  expect(screen.queryByRole('button', { name: 'July 1 to Today' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change report dates' }));
  await waitFor(() => expect(mockReport).toHaveBeenLastCalledWith('agent', '2026-07-01T00:00:00.000Z', '2026-10-21T23:59:59.999Z'));
});

test('shows the new columns for each team member and the team total', async () => {
  mockReport.mockResolvedValue({ teams: [{ teamLead: { $id: 'tl', name: 'Team Lead' },
    members: [{ user, metrics }, { user: { ...user, $id: 'other' }, metrics }], totals: metrics }] });
  render(<WeeklyReportDashboard user={user} />);
  expect(await screen.findByRole('columnheader', { name: 'LinkedIn Leads', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'LinkedIn Not Interested', exact: true })).toBeInTheDocument();
  expect(screen.getAllByRole('cell', { name: '4', exact: true })).toHaveLength(3);
  expect(screen.getAllByRole('cell', { name: '2', exact: true })).toHaveLength(3);
});
