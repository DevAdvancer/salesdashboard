import { canSetUserPassword, CRM_OWNER_EMAIL, CRM_OWNER_USER_ID } from '@/lib/utils/password-reset-policy';

const owner = { $id: CRM_OWNER_USER_ID, role: 'admin', email: CRM_OWNER_EMAIL };
const admin = { $id: 'admin-2', role: 'admin', email: 'other-admin@example.com' };
const roles = ['admin', 'developer', 'team_lead', 'senior_tl', 'agent', 'lead_generation', 'monitor', 'operations', 'compliance'];

it('lets an admin set passwords only for agents and team leads', () => {
  for (const role of roles) {
    expect(canSetUserPassword(admin, { $id: `t-${role}`, role })).toBe(role === 'agent' || role === 'team_lead');
  }
});
it('lets the CRM owner set any other user\'s password, admins included', () => {
  for (const role of roles) expect(canSetUserPassword(owner, { $id: `t-${role}`, role })).toBe(true);
});
it('never allows self-service through this path, inactive actors, non-admins or a look-alike owner', () => {
  expect(canSetUserPassword(owner, owner)).toBe(false);
  expect(canSetUserPassword({ ...admin, isActive: false }, { $id: 'a', role: 'agent' })).toBe(false);
  for (const role of ['developer', 'team_lead', 'senior_tl', 'monitor', 'operations']) {
    expect(canSetUserPassword({ $id: 'x', role }, { $id: 'a', role: 'agent' })).toBe(false);
  }
  expect(canSetUserPassword({ ...owner, $id: 'someone-else' }, { $id: 'a', role: 'admin' })).toBe(false);
  expect(canSetUserPassword({ ...owner, email: 'abhirupvizva@gmail.co' }, { $id: 'a', role: 'admin' })).toBe(false);
  expect(canSetUserPassword({ ...owner, role: 'developer' }, { $id: 'a', role: 'admin' })).toBe(false);
  expect(canSetUserPassword(null, { $id: 'a', role: 'agent' })).toBe(false);
});
