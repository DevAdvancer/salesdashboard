import fc from 'fast-check';
import { attendanceExempt, bypassCrmGate, canApproveCrmAccess } from '@/lib/utils/crm-access-policy';
import type { User } from '@/lib/types';

const user = (id: string, role: User['role'], department: User['department'] = 'sales') => ({ $id: id, role, department, teamLeadId: null, isActive: true });
it('exempts exactly the four agreed leadership roles from attendance', () => {
  fc.assert(fc.property(fc.constantFrom<User['role']>('admin', 'developer', 'monitor', 'operations', 'agent', 'lead_generation', 'team_lead', 'senior_tl', 'compliance'), role => {
    expect(attendanceExempt(role)).toBe(['admin', 'developer', 'monitor', 'operations'].includes(role));
  }));
});
it('never permits self approval, inactive approvers, inactive targets, or monitors', () => {
  fc.assert(fc.property(fc.uuid(), fc.constantFrom<User['role']>('admin', 'developer', 'operations', 'monitor', 'team_lead', 'senior_tl'), (id, role) => {
    const actor = user(id, role); const target = { ...user('target', 'agent'), teamLeadId: id };
    expect(canApproveCrmAccess(actor, { ...target, $id: id })).toBe(false);
    expect(canApproveCrmAccess({ ...actor, isActive: false }, target)).toBe(false);
    expect(canApproveCrmAccess(actor, { ...target, isActive: false })).toBe(false);
    expect(canApproveCrmAccess({ ...actor, role: 'monitor' }, target)).toBe(false);
  }));
});
it('restricts team leaders to their department and explicit hierarchy', () => {
  fc.assert(fc.property(fc.uuid(), fc.constantFrom<'sales' | 'resume'>('sales', 'resume'), (id, department) => {
    const actor = user(id, 'team_lead', department);
    const target = { ...user('target', 'agent', department), teamLeadId: id };
    expect(canApproveCrmAccess(actor, target)).toBe(true);
    expect(canApproveCrmAccess(actor, { ...target, teamLeadId: 'other' })).toBe(false);
    expect(canApproveCrmAccess(actor, { ...target, department: department === 'sales' ? 'resume' : 'sales' })).toBe(false);
    expect(canApproveCrmAccess({ ...actor, role: 'senior_tl' }, { ...target, teamLeadId: null, managerIds: [id] })).toBe(true);
  }));
});
it('does not let server actions inherit public-page exceptions or expose mail routes', () => {
  fc.assert(fc.property(fc.constantFrom('/login', '/referral', '/api/referrals', '/maintenance', '/api/security/access', '/api/cron/payment-reminders'), path => {
    expect(bypassCrmGate(path, 'POST', true)).toBe(false);
  }));
  expect(bypassCrmGate('/api/referrals', 'POST', false)).toBe(true);
  expect(bypassCrmGate('/api/referrals', 'GET', false)).toBe(false);
  for (const path of ['/api/auth/login', '/api/auth/callback', '/api/assessment/send-email', '/api/interview/send-email', '/api/mock/send-email', '/api/leads/list']) {
    expect(bypassCrmGate(path, 'GET', false)).toBe(false);
    expect(bypassCrmGate(path, 'POST', false)).toBe(false);
  }
});
