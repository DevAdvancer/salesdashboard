import type { UserRole } from '@/lib/types';
import { isClientExcludedStatus } from '@/lib/utils/client-history';

export const PROGRESS_STATUSES = ['New', 'Placed', 'Backout', 'Hold', 'Temp Hold', 'Low priority', 'Marketing in progress'] as const;
export type ProgressStatus = typeof PROGRESS_STATUSES[number];
export const DEFAULT_PROGRESS_STATUS: ProgressStatus = 'New';
const STATUS_VALUES: Record<ProgressStatus, readonly string[]> = {
  New: ['New'],
  Placed: ['Placed', 'Completed'],
  Backout: ['Backout', 'Backed Out'],
  Hold: ['Hold', 'On Hold'],
  'Temp Hold': ['Temp Hold'],
  'Low priority': ['Low priority'],
  'Marketing in progress': ['Marketing in progress', 'Onboarding', 'In Progress'],
};
/** Read compatibility only: existing documents require no migration or read-time writes. */
export function normalizeProgressStatus(value: string): ProgressStatus {
  return PROGRESS_STATUSES.find(status => STATUS_VALUES[status].includes(value)) || DEFAULT_PROGRESS_STATUS;
}
export function progressStatusFilterValues(status: ProgressStatus) { return [...STATUS_VALUES[status]]; }
export const PROGRESS_PAGE_SIZE = 10;
export const PROGRESS_SALESPERSON_ROLES = ['admin', 'agent', 'team_lead', 'senior_tl'] as const;
export const PROGRESS_ROLES: UserRole[] = ['admin', 'developer', 'monitor', 'operations', 'senior_tl', 'team_lead', 'agent', 'lead_generation', 'compliance'];
export type ProgressEntry = {
  $id: string; $updatedAt: string; leadId: string; source: 'lead' | 'manual';
  candidateName: string; email: string; phone: string; salespersonId: string; salespersonName: string;
  department: string; marketingTl: string; recruiterName: string; progressStatus: ProgressStatus;
  enteredAt: string; notes: string; finalFeedback: string; finalSavedAt: string;
  marketingStartedOn?: string;
  assignmentOverride: boolean; eligible: boolean;
};
export type ProgressSummary = Omit<ProgressEntry, 'notes' | 'finalFeedback' | 'finalSavedAt'>;
export type ProgressEvent = { $id: string; $createdAt: string; entryId: string; kind: string; text: string; authorId: string; authorName: string };
export type ProgressFilters = { search?: string; status?: string; salesperson?: string; marketingTl?: string; recruiter?: string; from?: string; to?: string };
export type ProgressActor = { $id: string; role: UserRole; department?: string; isActive?: boolean };

export function canAccessProgress(actor: ProgressActor) {
  return actor.isActive !== false && (actor.department || 'sales') === 'sales' && PROGRESS_ROLES.includes(actor.role);
}
export function canManageProgress(actor: ProgressActor) { return canAccessProgress(actor) && actor.role === 'admin'; }
export function canShareProgress(actor: ProgressActor) { return canManageProgress(actor); }
export function canManageMarketingTl(actor: ProgressActor) { return canManageProgress(actor) && (actor.department || 'sales') === 'sales'; }
export function canReadAllProgress(actor: ProgressActor) { return canAccessProgress(actor) && ['admin', 'developer', 'monitor', 'operations'].includes(actor.role); }
export function canEditProgress(actor: ProgressActor) { return canAccessProgress(actor) && !['operations', 'monitor', 'compliance'].includes(actor.role); }
export function isProgressEligible(status: string) { return !isClientExcludedStatus(status); }
export function canSeeProgress(actor: ProgressActor, entry: Pick<ProgressEntry, 'department' | 'salespersonId' | 'eligible' | 'progressStatus'>, visibleIds: readonly string[]) {
  return canAccessProgress(actor) && entry.department === 'sales' && entry.eligible && isProgressEligible(entry.progressStatus) &&
    (canReadAllProgress(actor) || ((actor.department || 'sales') === entry.department && visibleIds.includes(entry.salespersonId)));
}
export function canSaveFinalFeedback(actor: ProgressActor, saved: boolean) { return canManageProgress(actor) || (!saved && canEditProgress(actor)); }

export type HierarchyPerson = { $id: string; role?: string; department?: string; teamLeadId?: string; managerId?: string; teamLeadIds?: string[]; managerIds?: string[]; assistantManagerIds?: string[] };
export function progressHierarchyIds(actor: ProgressActor, users: HierarchyPerson[]) {
  const visible = new Set([actor.$id]);
  if (!['team_lead', 'senior_tl'].includes(actor.role)) return [...visible];
  let changed = true;
  while (changed) {
    changed = false;
    for (const user of users) {
      if (visible.has(user.$id) || (user.department || 'sales') !== (actor.department || 'sales')) continue;
      const parents = [user.teamLeadId, user.managerId, ...(user.teamLeadIds || []), ...(user.managerIds || []), ...(user.assistantManagerIds || [])];
      if (parents.some(id => id && visible.has(id))) { visible.add(user.$id); changed = true; }
    }
  }
  return [...visible];
}
