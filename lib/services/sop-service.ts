import {
  createCoachingNoteAction,
  createLeadNoteAction,
  createReviewQueueItemAction,
  listCoachingNotesAction,
  listLeadNotesAction,
  listNotificationsAction,
  listReviewQueueAction,
  listReviewTargetOptionsAction,
  markNotificationReadAction,
  updateLeadFollowUpAction,
  updateReviewQueueStatusAction,
} from '@/app/actions/sop';
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
  return updateLeadFollowUpAction(input);
}

export function listLeadNotes(actorId: string, leadId: string): Promise<LeadNote[]> {
  return listLeadNotesAction(actorId, leadId);
}

export function createLeadNote(input: {
  actorId: string;
  leadId: string;
  body: string;
  visibility: LeadNoteVisibility;
}): Promise<LeadNote> {
  return createLeadNoteAction(input);
}

export function listCoachingNotes(actorId: string, targetUserId?: string): Promise<CoachingNote[]> {
  return listCoachingNotesAction(actorId, targetUserId);
}

export function createCoachingNote(input: {
  actorId: string;
  targetUserId: string;
  targetUserName?: string | null;
  note: string;
  visibility: CoachingNoteVisibility;
}): Promise<CoachingNote> {
  return createCoachingNoteAction(input);
}

export function listReviewQueue(actorId: string, status?: string): Promise<ReviewQueueItem[]> {
  return listReviewQueueAction(actorId, status);
}

export function listReviewTargetOptions(input: {
  actorId: string;
  targetType: ReviewTargetType;
  searchQuery?: string;
}): Promise<ReviewTargetOption[]> {
  return listReviewTargetOptionsAction(input);
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
  return createReviewQueueItemAction(input);
}

export function updateReviewQueueStatus(
  actorId: string,
  itemId: string,
  status: string
): Promise<ReviewQueueItem> {
  return updateReviewQueueStatusAction(actorId, itemId, status);
}

export function listNotifications(actorId: string): Promise<NotificationRecord[]> {
  return listNotificationsAction(actorId);
}

export function markNotificationRead(
  actorId: string,
  notificationId: string
): Promise<NotificationRecord> {
  return markNotificationReadAction(actorId, notificationId);
}
