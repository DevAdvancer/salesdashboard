import { fireEvent, render, screen, within } from '@testing-library/react';
import { UserTable } from '@/components/users/user-table';
import type { User } from '@/lib/types';

jest.mock('@/components/users/set-password-dialog', () => ({ SetPasswordDialog: () => null }));

const admin: User = {
  $id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin',
  department: 'sales', teamLeadId: null, branchIds: [],
};
const completed: User = { ...admin, $id: 'done', name: 'Completed Agent', role: 'agent', isActive: false };
const pending: User = { ...completed, $id: 'pending', name: 'Pending Agent' };

it('shows completion only for confirmed handoffs and offers to finish pending ones', () => {
  const handleSetAgentActive = jest.fn();
  const props = {
    filteredUsers: [completed, pending], user: admin, isLoading: false, canCreate: true,
    activeDashboard: 'sales', isAdmin: true, isDeveloper: false, isTeamLead: false,
    isMonitor: false, isOperations: false, branchMap: new Map<string, string>(),
    search: '', setSearch: jest.fn(), handleEdit: jest.fn(), handleSetAgentActive, handleDeleteUser: jest.fn(),
    activeStatusUserId: null, deletingUserId: null, currentUsersPage: 1, setCurrentUsersPage: jest.fn(),
    usersTotal: 2, activeUsersTotal: 0, inactiveUsersTotal: 2, statusFilter: 'inactive' as const,
    setStatusFilter: jest.fn(), USERS_PAGE_SIZE: 50,
  };
  const { rerender } = render(<UserTable {...props} checkingHandoffs completedHandoffIds={new Set()} />);
  expect(screen.queryByText('Handoff completed')).toBeNull();

  rerender(<UserTable {...props} checkingHandoffs={false} completedHandoffIds={new Set([completed.$id])} />);
  const completedRow = within(screen.getByRole('row', { name: /Completed Agent/ }));
  expect(completedRow.getByText('Handoff completed')).toBeInTheDocument();
  expect(completedRow.queryByRole('button', { name: 'Complete handoff' })).toBeNull();
  const pendingRow = within(screen.getByRole('row', { name: /Pending Agent/ }));
  expect(pendingRow.queryByText('Handoff completed')).toBeNull();
  fireEvent.click(pendingRow.getByRole('button', { name: 'Complete handoff' }));
  expect(handleSetAgentActive).toHaveBeenCalledWith(pending, false);
});
