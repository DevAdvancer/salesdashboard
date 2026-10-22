import fc from 'fast-check';
import { crmHomePath } from '@/lib/utils/crm-home-path';
it('routes department users to their permitted home and respects leadership dashboard selection', () => {
  fc.assert(fc.property(fc.constantFrom('agent', 'team_lead', 'senior_tl', 'lead_generation'), role => {
    expect(crmHomePath({ role, department: 'resume' }, 'sales')).toBe('/resume-dashboard');
    expect(crmHomePath({ role, department: 'sales' }, 'sales')).toBe('/dashboard');
  }));
  fc.assert(fc.property(fc.constantFrom('admin', 'developer', 'monitor', 'operations'), role => {
    expect(crmHomePath({ role, department: 'resume' }, 'sales')).toBe('/dashboard');
    expect(crmHomePath({ role }, 'resume')).toBe('/resume-dashboard');
  }));
  expect(crmHomePath({ role: 'compliance' }, 'resume')).toBe('/compliance-dashboard');
});
