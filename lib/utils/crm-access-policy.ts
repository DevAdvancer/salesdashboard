import type { User } from '@/lib/types';
import { easternWallTimeToIso, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';

export function attendanceGateStartsAt(now = new Date()) {
  return easternWallTimeToIso(`${getCurrentEasternIsoDate(now)}T10:00`);
}
export function attendanceGateApplies(now = new Date()) {
  return now.getTime() >= Date.parse(attendanceGateStartsAt(now));
}

export const ATTENDANCE_EXEMPT_ROLES = ['admin', 'developer', 'monitor', 'operations'] as const;
export function attendanceExempt(role: string) {
  return (ATTENDANCE_EXEMPT_ROLES as readonly string[]).includes(role);
}

type ManagedUser = Pick<User, '$id' | 'role' | 'department' | 'teamLeadId' | 'isActive'> & {
  managerId?: string | null; managerIds?: string[]; assistantManagerIds?: string[];
};
export function canApproveCrmAccess(actor: ManagedUser, target: ManagedUser) {
  if (actor.isActive === false || target.isActive === false || actor.$id === target.$id) return false;
  if (actor.role === 'admin' || actor.role === 'developer' || actor.role === 'operations') return true;
  if ((actor.department || 'sales') !== (target.department || 'sales')) return false;
  if (actor.role !== 'team_lead' && actor.role !== 'senior_tl') return false;
  return [target.teamLeadId, target.managerId, ...target.managerIds || [], ...target.assistantManagerIds || []].includes(actor.$id);
}

export function normalizeVerificationName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/** Public GET pages do not exempt server actions posted to the same URL. */
export function bypassCrmGate(path: string, method: string, serverAction: boolean) {
  if (serverAction) return false;
  if (path.startsWith('/api/cron/')) return true; // Each job checks CRON_SECRET itself.
  if (path === '/api/security/access' || path === '/api/auth/appwrite-session') return true;
  if (path === '/api/referrals' && method === 'POST') return true; // Public intake only; no CRM reads or approval mutations.
  // This handler enforces the gate itself, with a narrow own-profile bootstrap exception.
  if (path.startsWith('/api/appwrite/')) return true;
  if (method === 'GET' || method === 'HEAD') {
    return ['/login', '/referral', '/maintenance', '/api/maintenance/status', '/api/security/readiness'].includes(path);
  }
  return false;
}
