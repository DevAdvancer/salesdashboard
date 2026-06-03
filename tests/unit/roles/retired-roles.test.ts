import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { isValidRole, VALID_ROLES } from '@/lib/types';
import { getSignupRoleForEmail } from '@/lib/utils/user-hierarchy';

describe('retired manager roles', () => {
  it('removes manager and assistant manager from the valid role set', () => {
    expect(VALID_ROLES).not.toContain('manager');
    expect(VALID_ROLES).not.toContain('assistant_manager');
    expect(isValidRole('manager')).toBe(false);
    expect(isValidRole('assistant_manager')).toBe(false);
  });

  it('does not grant component access to retired roles', () => {
    expect(isRoleEligibleForComponent('dashboard', 'manager' as never)).toBe(false);
    expect(isRoleEligibleForComponent('user-management', 'assistant_manager' as never)).toBe(false);
  });

  it('uses admin as the default signup role for non-bootstrap users', () => {
    expect(getSignupRoleForEmail('new-user@example.com')).toBe('admin');
  });
});
