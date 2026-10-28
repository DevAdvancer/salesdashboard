import { addDays, format, isWeekend, parseISO } from 'date-fns';
import { easternWallTimeToIso, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';

export function attendanceGateStartsAt(now = new Date()) {
  return easternWallTimeToIso(`${getCurrentEasternIsoDate(now)}T10:00`);
}
export function attendanceGateApplies(now = new Date()) {
  return !isWeekend(parseISO(getCurrentEasternIsoDate(now))) && now.getTime() >= Date.parse(attendanceGateStartsAt(now));
}
export function attendanceSelfMarkOpen(now = new Date()) {
  return !isWeekend(parseISO(getCurrentEasternIsoDate(now))) && now.getTime() < Date.parse(attendanceGateStartsAt(now));
}

/** Next weekday review, always in the future and based on New York wall time. */
export function nextAttendanceReviewAt(now = new Date()) {
  const today = parseISO(getCurrentEasternIsoDate(now));
  for (let offset = 0; offset <= 3; offset++) {
    const day = addDays(today, offset);
    if (isWeekend(day)) continue;
    const review = easternWallTimeToIso(`${format(day, 'yyyy-MM-dd')}T10:00`);
    if (Date.parse(review) > now.getTime()) return review;
  }
  throw new Error('Could not schedule the next attendance review.');
}

export const ATTENDANCE_EXEMPT_ROLES = ['admin', 'developer', 'monitor', 'operations'] as const;
export function attendanceExempt(role: string) {
  return (ATTENDANCE_EXEMPT_ROLES as readonly string[]).includes(role);
}

/** Public GET pages do not exempt server actions posted to the same URL. */
export function bypassCrmGate(path: string, method: string, serverAction: boolean) {
  if (serverAction) return false;
  if (path.startsWith('/api/cron/')) return true; // Each job checks CRON_SECRET itself.
  if (path === '/api/security/access' || path === '/api/auth/appwrite-session') return true;
  // This GET handler runs verifiedBrowserActor before every snapshot. Let it
  // authorize once instead of validating the native session in proxy and handler.
  if (path === '/api/security/changes' && method === 'GET') return true;
  if (path === '/api/referrals' && method === 'POST') return true; // Public intake only; no CRM reads or approval mutations.
  // This handler enforces the gate itself, with a narrow own-profile bootstrap exception.
  if (path.startsWith('/api/appwrite/')) return true;
  if (method === 'GET' || method === 'HEAD') {
    return ['/login', '/referral', '/maintenance', '/api/maintenance/status', '/api/security/readiness'].includes(path);
  }
  return false;
}
