import { User } from '@/lib/types';

describe('TeamLead User Visibility', () => {
  it('should filter out other teamLeads from the user list', () => {
    const currentManagerId = 'mgr-1';
    const users: User[] = [
      { $id: 'mgr-1', role: 'team_lead', name: 'Me', email: 'me@test.com', branchIds: [], teamLeadId: null, teamLeadId: null },
      { $id: 'mgr-2', role: 'team_lead', name: 'Other TeamLead', email: 'other@test.com', branchIds: [], teamLeadId: null, teamLeadId: null },
      { $id: 'tl-1', role: 'team_lead', name: 'Team Lead', email: 'tl@test.com', branchIds: [], teamLeadId: 'mgr-1', teamLeadId: null },
      { $id: 'agent-1', role: 'agent', name: 'Agent', email: 'agent@test.com', branchIds: [], teamLeadId: 'mgr-1', teamLeadId: 'tl-1' },
    ];

    // The logic added to app/users/page.tsx:
    const filteredUsers = users.filter(u => u.role !== 'team_lead' || u.$id === currentManagerId);

    expect(filteredUsers).toHaveLength(3);
    expect(filteredUsers.find(u => u.$id === 'mgr-1')).toBeDefined();
    expect(filteredUsers.find(u => u.$id === 'mgr-2')).toBeUndefined();
    expect(filteredUsers.find(u => u.$id === 'tl-1')).toBeDefined();
    expect(filteredUsers.find(u => u.$id === 'agent-1')).toBeDefined();
  });
});
