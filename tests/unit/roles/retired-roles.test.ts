import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { isValidRole, VALID_ROLES } from '@/lib/types';
import { getSignupRoleForEmail } from '@/lib/utils/user-hierarchy';

describe('retired teamLead roles', () => {
  it('removes teamLead and assistant teamLead from the valid role set', () => {
    expect(VALID_ROLES).not.toContain('team_lead');
    expect(VALID_ROLES).not.toContain('assistant_team_lead');
    expect(isValidRole('team_lead')).toBe(false);
    expect(isValidRole('assistant_team_lead')).toBe(false);
  });

  it('does not grant component access to retired roles', () => {
    expect(isRoleEligibleForComponent('dashboard', 'team_lead' as never)).toBe(false);
    expect(isRoleEligibleForComponent('user-management', 'assistant_team_lead' as never)).toBe(false);
  });

  it('uses admin as the default signup role for non-bootstrap users', () => {
    expect(getSignupRoleForEmail('new-user@example.com')).toBe('admin');
  });
});
