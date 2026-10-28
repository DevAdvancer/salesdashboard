import fc from 'fast-check';
import { attendanceExempt, attendanceGateApplies, attendanceGateStartsAt, attendanceSelfMarkOpen, nextAttendanceReviewAt, bypassCrmGate } from '@/lib/utils/crm-access-policy';
import { easternWallTimeToIso } from '@/lib/utils/eastern-date';

it('starts weekday attendance enforcement at exactly 10 AM New York across summer and winter', () => {
  fc.assert(fc.property(fc.constantFrom('2026-01-15', '2026-03-08', '2026-07-15', '2026-11-01', '2026-12-15'),
    fc.integer({ min: 0, max: 1439 }), (day, minute) => {
      const value = `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      let now: Date;
      try { now = new Date(easternWallTimeToIso(value)); } catch { return; } // Spring-forward gap has no instant.
      const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
      expect(attendanceGateApplies(now)).toBe(!weekend && minute >= 600);
      expect(attendanceSelfMarkOpen(now)).toBe(!weekend && minute < 600);
      expect(attendanceGateStartsAt(now)).toBe(easternWallTimeToIso(`${day}T10:00`));
    }));
});
it('always schedules the next review on a future weekday at 10 AM Eastern, including DST weekends', () => {
  fc.assert(fc.property(fc.date({ min: new Date('2025-01-01T00:00:00Z'), max: new Date('2027-12-31T23:59:59Z'), noInvalidDate: true }), now => {
    const next = new Date(nextAttendanceReviewAt(now));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(next).map(part => [part.type, part.value]));
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(73 * 60 * 60 * 1000);
    expect(['Sat', 'Sun']).not.toContain(parts.weekday);
    expect(parts.hour).toBe('10'); expect(parts.minute).toBe('00');
  }));
  expect(nextAttendanceReviewAt(new Date('2026-10-30T14:00:00Z'))).toBe('2026-11-02T15:00:00.000Z');
  expect(nextAttendanceReviewAt(new Date('2026-03-06T15:00:00Z'))).toBe('2026-03-09T14:00:00.000Z');
});
import type { User } from '@/lib/types';

it('exempts exactly the four agreed leadership roles from attendance', () => {
  fc.assert(fc.property(fc.constantFrom<User['role']>('admin', 'developer', 'monitor', 'operations', 'agent', 'lead_generation', 'team_lead', 'senior_tl', 'compliance'), role => {
    expect(attendanceExempt(role)).toBe(['admin', 'developer', 'monitor', 'operations'].includes(role));
  }));
});
it('does not let server actions inherit public-page exceptions or expose mail routes', () => {
  fc.assert(fc.property(fc.constantFrom('/login', '/referral', '/api/referrals', '/maintenance', '/api/security/access', '/api/cron/payment-reminders'), path => {
    expect(bypassCrmGate(path, 'POST', true)).toBe(false);
  }));
  expect(bypassCrmGate('/api/referrals', 'POST', false)).toBe(true);
  expect(bypassCrmGate('/api/referrals', 'GET', false)).toBe(false);
  expect(bypassCrmGate('/api/security/changes', 'GET', false)).toBe(true);
  fc.assert(fc.property(fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE'), method => {
    expect(bypassCrmGate('/api/security/changes', method, true)).toBe(false);
    if (method !== 'GET') expect(bypassCrmGate('/api/security/changes', method, false)).toBe(false);
    expect(bypassCrmGate('/api/security/changes/extra', method, false)).toBe(false);
  }));
  for (const path of ['/api/auth/login', '/api/auth/callback', '/api/assessment/send-email', '/api/interview/send-email', '/api/mock/send-email', '/api/leads/list']) {
    expect(bypassCrmGate(path, 'GET', false)).toBe(false);
    expect(bypassCrmGate(path, 'POST', false)).toBe(false);
  }
});
