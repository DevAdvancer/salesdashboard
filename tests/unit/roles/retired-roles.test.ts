import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { isValidRole, VALID_ROLES } from '@/lib/types';
import { getSignupRoleForEmail } from '@/lib/utils/user-hierarchy';

// The retired roles are the legacy `manager` / `assistant_manager` pair that
// `team_lead` replaced. A blanket manager -> teamLead rename (commit 9b76b2a)
// rewrote the names in this file, which made it assert that the live
// `team_lead` role no longer exists. `team_lead` is very much current: it is
// in `UserRole`, in `VALID_ROLES`, and it carries component access, so the
// assertions below are back on the names that really were retired.
describe('retired manager roles', () => {
  it('removes manager and assistant manager from the valid role set', () => {
    expect(VALID_ROLES).not.toContain('manager');
    expect(VALID_ROLES).not.toContain('assistant_manager');
    expect(VALID_ROLES).not.toContain('assistant_team_lead');
    expect(isValidRole('manager')).toBe(false);
    expect(isValidRole('assistant_manager')).toBe(false);
    expect(isValidRole('assistant_team_lead')).toBe(false);
    // The replacement role is still valid.
    expect(VALID_ROLES).toContain('team_lead');
    expect(isValidRole('team_lead')).toBe(true);
  });

  it('does not grant component access to retired roles', () => {
    expect(isRoleEligibleForComponent('dashboard', 'manager' as never)).toBe(false);
    expect(isRoleEligibleForComponent('user-management', 'assistant_manager' as never)).toBe(false);
    expect(isRoleEligibleForComponent('user-management', 'assistant_team_lead' as never)).toBe(false);
    // ...but the surviving team_lead role does keep its access.
    expect(isRoleEligibleForComponent('dashboard', 'team_lead')).toBe(true);
    expect(isRoleEligibleForComponent('user-management', 'team_lead')).toBe(true);
  });

  it('uses admin as the default signup role for non-bootstrap users', () => {
    expect(getSignupRoleForEmail('new-user@example.com')).toBe('admin');
  });
});
