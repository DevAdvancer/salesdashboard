import {
  createCoachingNoteAction,
  createLeadNoteAction,
  createReviewQueueItemAction,
  listCoachingNotesAction,
  listLeadNotesAction,
  listNotificationsAction,
  listReviewQueueAction,
  listReviewTargetOptionsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  updateLeadFollowUpAction,
  updateReviewQueueStatusAction,
} from '@/app/actions/sop';
import { cacheClientRead, clearClientReadCache } from '@/lib/utils/client-read-cache';
import type { ReviewTargetOption, ReviewTargetType } from '@/lib/utils/review-target-options';
import type {
  CoachingNote,
  CoachingNoteVisibility,
  Lead,
  LeadNote,
  LeadNoteVisibility,
  NotificationRecord,
  ReviewQueueItem,
} from '@/lib/types';

export interface UpdateLeadFollowUpInput {
  actorId: string;
  leadId: string;
  nextFollowUpAt?: string | null;
  nextAction?: string | null;
  lastContactedAt?: string | null;
  followUpStatus?: string | null;
}

export function updateLeadFollowUp(input: UpdateLeadFollowUpInput): Promise<Lead> {
  return updateLeadFollowUpAction(input).finally(clearClientReadCache);
}

export function listLeadNotes(actorId: string, leadId: string): Promise<LeadNote[]> {
  return cacheClientRead('sop:listLeadNotes', [actorId, leadId], () =>
    listLeadNotesAction(actorId, leadId)
  );
}

export function createLeadNote(input: {
  actorId: string;
  leadId: string;
  body: string;
  visibility: LeadNoteVisibility;
}): Promise<LeadNote> {
  return createLeadNoteAction(input).finally(clearClientReadCache);
}

export function listCoachingNotes(actorId: string, targetUserId?: string): Promise<CoachingNote[]> {
  return cacheClientRead('sop:listCoachingNotes', [actorId, targetUserId], () =>
    listCoachingNotesAction(actorId, targetUserId)
  );
}

export function createCoachingNote(input: {
  actorId: string;
  targetUserId: string;
  targetUserName?: string | null;
  note: string;
  visibility: CoachingNoteVisibility;
}): Promise<CoachingNote> {
  return createCoachingNoteAction(input).finally(clearClientReadCache);
}

export function listReviewQueue(actorId: string, status?: string): Promise<ReviewQueueItem[]> {
  return cacheClientRead('sop:listReviewQueue', [actorId, status], () =>
    listReviewQueueAction(actorId, status)
  );
}

export function listReviewTargetOptions(input: {
  actorId: string;
  targetType: ReviewTargetType;
  searchQuery?: string;
}): Promise<ReviewTargetOption[]> {
  return cacheClientRead('sop:listReviewTargetOptions', [input], () =>
    listReviewTargetOptionsAction(input)
  );
}

export function createReviewQueueItem(input: {
  actorId: string;
  type: string;
  targetId: string;
  targetType: string;
  assignedReviewerId?: string | null;
  reason?: string | null;
  metadata?: string | null;
}): Promise<ReviewQueueItem> {
  return createReviewQueueItemAction(input).finally(clearClientReadCache);
}

export function updateReviewQueueStatus(
  actorId: string,
  itemId: string,
  status: string
): Promise<ReviewQueueItem> {
  return updateReviewQueueStatusAction(actorId, itemId, status).finally(clearClientReadCache);
}

export function listNotifications(
  actorId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<NotificationRecord[]> {
  return cacheClientRead('sop:listNotifications', [actorId], () =>
    listNotificationsAction(actorId),
    { forceRefresh: options.forceRefresh }
  );
}

export function markNotificationRead(
  actorId: string,
  notificationId: string
): Promise<NotificationRecord> {
  return markNotificationReadAction(actorId, notificationId).finally(clearClientReadCache);
}

export function markAllNotificationsRead(actorId: string): Promise<{ updatedCount: number }> {
  return markAllNotificationsReadAction(actorId).finally(clearClientReadCache);
}
