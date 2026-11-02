import fc from 'fast-check';
import { getDefaultComponentAccess, isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { DEFAULT_ACCESS_RULES, type ComponentKey, type UserRole } from '@/lib/constants/default-access';
import { NAV_ITEMS } from '@/components/navigation-config';

test('the retired Reminders component is unavailable for every role', () => {
  const roles: UserRole[] = ['admin', 'developer', 'monitor', 'operations', 'senior_tl', 'team_lead', 'agent', 'lead_generation', 'compliance'];
  fc.assert(fc.property(fc.constantFrom(...roles), role => {
    // Also cover old persisted component keys that can outlive the removed route.
    expect(isRoleEligibleForComponent('calendar' as ComponentKey, role)).toBe(false);
    expect(getDefaultComponentAccess('calendar' as ComponentKey, role)).toBe(false);
    expect(DEFAULT_ACCESS_RULES.some(rule => String(rule.componentKey) === 'calendar' && rule.role === role)).toBe(false);
  }));
  expect(NAV_ITEMS.some(item => item.key === 'calendar' || item.href === '/reminders')).toBe(false);
});
