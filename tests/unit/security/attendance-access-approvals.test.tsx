import { render, screen } from '@testing-library/react';
import { AttendanceAccessApprovals } from '@/components/attendance-access-approvals';
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { $id: 'manager', role: 'admin' } }) }));
it('only shows delegate approvals, with no new mark-present control', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ requests: [] }) });
  render(<AttendanceAccessApprovals />);
  expect(await screen.findByText('No access requests for your team today.')).toBeInTheDocument();
  expect(screen.queryByText(/Mark a team member present/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Mark present/ })).not.toBeInTheDocument();
});
it('shows a failed lookup without incorrectly saying no requests exist', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not load delegate requests.' }) });
  render(<AttendanceAccessApprovals />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load delegate requests.');
  expect(screen.queryByText('No access requests for your team today.')).not.toBeInTheDocument();
});
