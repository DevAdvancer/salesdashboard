import {
  BOOTSTRAP_ADMIN_EMAIL,
  buildHierarchy,
  canCreateOrphanTeamLead,
  getSignupRoleForEmail,
} from '@/lib/utils/user-hierarchy';

describe('user hierarchy rules', () => {
  it('promotes the bootstrap email to admin on signup', () => {
    expect(getSignupRoleForEmail(BOOTSTRAP_ADMIN_EMAIL)).toBe('admin');
    expect(getSignupRoleForEmail(`  ${BOOTSTRAP_ADMIN_EMAIL.toUpperCase()}  `)).toBe('admin');
    expect(getSignupRoleForEmail('teamLead@example.com')).toBe('team_lead');
  });

  it('allows only admins to create a team lead without a teamLead', () => {
    expect(canCreateOrphanTeamLead({ callerRole: 'admin', teamLeadIds: [] })).toBe(true);
    expect(canCreateOrphanTeamLead({ callerRole: 'team_lead', teamLeadIds: [] })).toBe(false);
    expect(canCreateOrphanTeamLead({ callerRole: 'admin', teamLeadIds: ['mgr-1'] })).toBe(false);
  });

  it('keeps managerless team leads managerless', () => {
    const hierarchy = buildHierarchy({
      callerRole: 'admin',
      callerId: 'admin-1',
      inputManagerIds: [],
    });

    expect(hierarchy).toEqual({
      teamLeadId: null,
      teamLeadIds: [],
      assistantManagerIds: [],
    });
  });

  it('adds assistant teamLeads into the team lead hierarchy chain', () => {
    const hierarchy = buildHierarchy({
      callerRole: 'admin',
      callerId: 'admin-1',
      inputManagerIds: ['mgr-1'],
      inputAssistantManagerIds: ['am-1'],
    });

    expect(hierarchy).toEqual({
      teamLeadId: 'mgr-1',
      teamLeadIds: ['mgr-1', 'am-1'],
      assistantManagerIds: ['am-1'],
    });
  });
});
