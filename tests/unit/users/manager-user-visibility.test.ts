import { User } from '@/lib/types';

describe('Manager User Visibility', () => {
  it('should filter out other managers from the user list', () => {
    const currentManagerId = 'mgr-1';
    const users: User[] = [
      { $id: 'mgr-1', role: 'manager', name: 'Me', email: 'me@test.com', branchIds: [], managerId: null, teamLeadId: null },
      { $id: 'mgr-2', role: 'manager', name: 'Other Manager', email: 'other@test.com', branchIds: [], managerId: null, teamLeadId: null },
      { $id: 'tl-1', role: 'team_lead', name: 'Team Lead', email: 'tl@test.com', branchIds: [], managerId: 'mgr-1', teamLeadId: null },
      { $id: 'agent-1', role: 'agent', name: 'Agent', email: 'agent@test.com', branchIds: [], managerId: 'mgr-1', teamLeadId: 'tl-1' },
    ];

    // The logic added to app/users/page.tsx:
    const filteredUsers = users.filter(u => u.role !== 'manager' || u.$id === currentManagerId);

    expect(filteredUsers).toHaveLength(3);
    expect(filteredUsers.find(u => u.$id === 'mgr-1')).toBeDefined();
    expect(filteredUsers.find(u => u.$id === 'mgr-2')).toBeUndefined();
    expect(filteredUsers.find(u => u.$id === 'tl-1')).toBeDefined();
    expect(filteredUsers.find(u => u.$id === 'agent-1')).toBeDefined();
  });
});
