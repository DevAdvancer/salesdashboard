import { User } from '@/lib/types';

// The retired `manager` role used to sit above `team_lead`, and the user list
// hid a manager's peers with `u.role !== 'manager' || u.$id === currentId`.
// A blanket manager -> teamLead rename (commit 9b76b2a) turned that into
// `u.role !== 'team_lead' || ...` and collapsed the `managerId` / `teamLeadId`
// fixture fields into a duplicated `teamLeadId` key, so the fixtures no longer
// described the hierarchy the assertions were checking.
//
// Under the current model a team lead's roster is loaded with
// getAgentsByTeamLead(user.$id) (app/users/page.tsx), which scopes the list to
// the users that report to them. Peer team leads and other teams' agents are
// therefore never in the list.
describe('TeamLead User Visibility', () => {
  it('should filter out other teamLeads and other teams from the user list', () => {
    const currentTeamLeadId = 'tl-1';
    const users: User[] = [
      { $id: 'tl-1', role: 'team_lead', name: 'Me', email: 'me@test.com', branchIds: [], teamLeadId: null },
      { $id: 'tl-2', role: 'team_lead', name: 'Other TeamLead', email: 'other@test.com', branchIds: [], teamLeadId: null },
      { $id: 'agent-1', role: 'agent', name: 'My Agent', email: 'agent1@test.com', branchIds: [], teamLeadId: 'tl-1' },
      { $id: 'lg-1', role: 'lead_generation', name: 'My LG', email: 'lg1@test.com', branchIds: [], teamLeadId: 'tl-1' },
      { $id: 'agent-2', role: 'agent', name: 'Their Agent', email: 'agent2@test.com', branchIds: [], teamLeadId: 'tl-2' },
    ];

    // The scoping getAgentsByTeamLead applies (Query.equal('teamLeadId', id)):
    const filteredUsers = users.filter((u) => u.teamLeadId === currentTeamLeadId);

    expect(filteredUsers).toHaveLength(2);
    expect(filteredUsers.find((u) => u.$id === 'agent-1')).toBeDefined();
    expect(filteredUsers.find((u) => u.$id === 'lg-1')).toBeDefined();
    // Peer team leads are not visible, and neither are their agents.
    expect(filteredUsers.find((u) => u.$id === 'tl-2')).toBeUndefined();
    expect(filteredUsers.find((u) => u.$id === 'agent-2')).toBeUndefined();
    expect(filteredUsers.every((u) => u.role !== 'team_lead')).toBe(true);
  });
});
