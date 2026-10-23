import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttendancePage from '@/app/attendance/page';
import { loadAttendanceTeamAction } from '@/app/actions/attendance/bootstrap';
const mockToday = '2026-10-23';
let mockUser = { $id: 'tl', role: 'team_lead', name: 'Team Lead' };
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/components/protected-route', () => ({ ProtectedRoute: ({ children }: any) => children }));
jest.mock('@/components/attendance-access-approvals', () => ({ AttendanceAccessApprovals: () => null }));
jest.mock('@/components/ui/date-picker', () => ({ DatePicker: ({ value, onChange }: any) => <input aria-label="Attendance date" value={value} onChange={event => onChange(event.target.value)} /> }));
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/app/actions/attendance/bootstrap', () => ({ loadAttendanceTeamAction: jest.fn() }));
jest.mock('@/app/actions/attendance/notifications', () => ({ checkAndNotifyMyTeamAbsencesAction: jest.fn(async () => ({})), checkAndNotifyAdminAttendanceEscalationsAction: jest.fn(async () => ({})) }));
jest.mock('@/app/actions/attendance/list', () => ({ listTeamLeadsAttendanceForAdminAction: jest.fn() }));
jest.mock('@/app/actions/attendance/delegate', () => ({ assignAttendanceDelegateAction: jest.fn() }));
jest.mock('@/app/actions/attendance/mark', () => ({ markAttendancePresentByTeamLeadAction: jest.fn() }));
jest.mock('@/app/actions/attendance/report', () => ({ getAttendanceFlagSummaryAction: jest.fn() }));
const result = (date = mockToday, name = 'Current agent') => ({ attendance: { dateKey: date, teamLead: { userId: 'tl', userName: 'Team Lead', present: true },
  rows: [{ userId: 'agent', userName: name, present: true, linkedinAccounts: [] }], delegateOptions: [] },
  summary: { referenceDateKey: date, week: { startDateKey: date, endDateKey: date, flaggedCount: 0 }, month: { startDateKey: date, endDateKey: date, flaggedCount: 0 } } });
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-23T13:00:00Z'));
  mockUser = { $id: 'tl', role: 'team_lead', name: 'Team Lead' };
  (loadAttendanceTeamAction as jest.Mock).mockReset().mockResolvedValue(result());
});
afterEach(() => jest.useRealTimers());
it('loads the current date once and does not reload for an equivalent profile object', async () => {
  const view = render(<AttendancePage />);
  expect(await screen.findByText('Current agent')).toBeInTheDocument();
  expect(loadAttendanceTeamAction).toHaveBeenCalledTimes(1);
  expect(loadAttendanceTeamAction).toHaveBeenCalledWith({ currentUserId: 'tl', dateKey: mockToday });
  mockUser = { ...mockUser };
  view.rerender(<AttendancePage />);
  await act(async () => {});
  expect(loadAttendanceTeamAction).toHaveBeenCalledTimes(1);
});
it('ignores an older date response when the user has already selected another date', async () => {
  render(<AttendancePage />);
  await screen.findByText('Current agent');
  let finishOld!: (value: unknown) => void;
  (loadAttendanceTeamAction as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '2026-10-22' } });
  await waitFor(() => expect(loadAttendanceTeamAction).toHaveBeenCalledTimes(2));
  (loadAttendanceTeamAction as jest.Mock).mockResolvedValueOnce(result('2026-10-21', 'Newest selection'));
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '2026-10-21' } });
  expect(await screen.findByText('Newest selection')).toBeInTheDocument();
  await act(async () => { finishOld(result('2026-10-22', 'Outdated result')); });
  expect(screen.getByText('Newest selection')).toBeInTheDocument();
  expect(screen.queryByText('Outdated result')).not.toBeInTheDocument();
});
