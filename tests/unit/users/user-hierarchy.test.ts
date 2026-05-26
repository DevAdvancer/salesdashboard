import {
  BOOTSTRAP_ADMIN_EMAIL,
  buildTeamLeadHierarchy,
  canCreateManagerlessTeamLead,
  getSignupRoleForEmail,
} from '@/lib/utils/user-hierarchy';

describe('user hierarchy rules', () => {
  it('promotes the bootstrap email to admin on signup', () => {
    expect(getSignupRoleForEmail(BOOTSTRAP_ADMIN_EMAIL)).toBe('admin');
    expect(getSignupRoleForEmail(`  ${BOOTSTRAP_ADMIN_EMAIL.toUpperCase()}  `)).toBe('admin');
    expect(getSignupRoleForEmail('manager@example.com')).toBe('manager');
  });

  it('allows only admins to create a team lead without a manager', () => {
    expect(canCreateManagerlessTeamLead({ callerRole: 'admin', managerIds: [] })).toBe(true);
    expect(canCreateManagerlessTeamLead({ callerRole: 'manager', managerIds: [] })).toBe(false);
    expect(canCreateManagerlessTeamLead({ callerRole: 'admin', managerIds: ['mgr-1'] })).toBe(false);
  });

  it('keeps managerless team leads managerless', () => {
    const hierarchy = buildTeamLeadHierarchy({
      callerRole: 'admin',
      callerId: 'admin-1',
      inputManagerIds: [],
    });

    expect(hierarchy).toEqual({
      managerId: null,
      managerIds: [],
      assistantManagerIds: [],
    });
  });

  it('adds assistant managers into the team lead hierarchy chain', () => {
    const hierarchy = buildTeamLeadHierarchy({
      callerRole: 'admin',
      callerId: 'admin-1',
      inputManagerIds: ['mgr-1'],
      inputAssistantManagerIds: ['am-1'],
    });

    expect(hierarchy).toEqual({
      managerId: 'mgr-1',
      managerIds: ['mgr-1', 'am-1'],
      assistantManagerIds: ['am-1'],
    });
  });
});
