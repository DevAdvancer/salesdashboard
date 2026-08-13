import {
  createLeadNoteAction,
  listLeadNotesAction,
  listNotificationsAction,
  clearAllNotificationsAction,
  markNotificationReadAction,
  updateLeadFollowUpAction,
} from '@/app/actions/sop';
import { cacheClientRead, clearClientReadCache } from '@/lib/utils/client-read-cache';
import type {
  Lead,
  LeadNote,
  LeadNoteVisibility,
  NotificationRecord,
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
  return updateLeadFollowUpAction(input).finally(() => clearClientReadCache('sop:'));
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
  return createLeadNoteAction(input).finally(() => clearClientReadCache('sop:listLeadNotes'));
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
  return markNotificationReadAction(actorId, notificationId).finally(() => clearClientReadCache('sop:listNotifications'));
}

export function clearAllNotifications(actorId: string): Promise<{ deletedCount: number }> {
  return clearAllNotificationsAction(actorId).finally(() => clearClientReadCache('sop:listNotifications'));
}
