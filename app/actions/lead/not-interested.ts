import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { resolveProgressVisibleIds } from '@/lib/server/client-progress-scope';
import type { createAdminClient } from '@/lib/server/appwrite';
import type { Lead, NotInterestedLeadEvent } from '@/lib/types';
import { parseLeadHistory } from '@/lib/utils/lead-history-snapshot';
import { normalizeLeadStatus } from '@/lib/utils/lead-status-workflow';
import { isAdminLikeReadAllRole } from '@/lib/utils/role-utils';
import { getUnassignedOwnerId } from '@/lib/actions/lead/utils';
import { getDepartmentScopedUserIds, getTeamLeadLeadVisibilityScope, type UserDocument } from './visibility';

type Databases = Awaited<ReturnType<typeof createAdminClient>>['databases'];
type LeadScope = { owners: Set<string>; assignees: Set<string> };
type Attribution = Pick<Lead, 'ownerId' | 'assignedToId'>;

export const NOT_INTERESTED_STATUSES = ['Not Interested', 'Not-Interested'];

export async function getNotInterestedScope(databases: Databases, viewer: UserDocument): Promise<LeadScope> {
  if (viewer.role === 'senior_tl') {
    const team = new Set(await resolveProgressVisibleIds(databases, viewer));
    return { owners: team, assignees: team };
  }

  if (!isAdminLikeReadAllRole(viewer.role) && viewer.role !== 'team_lead') {
    return {
      owners: new Set([viewer.$id]),
      assignees: new Set(viewer.role === 'agent' ? [viewer.$id] : []),
    };
  }

  const salesUsers = await getDepartmentScopedUserIds(databases, 'sales');
  if (isAdminLikeReadAllRole(viewer.role)) {
    return { owners: salesUsers, assignees: salesUsers };
  }

  const { ownerVisibleUserIds, assignmentVisibleUserIds } = await getTeamLeadLeadVisibilityScope(databases, viewer.$id);
  return {
    owners: new Set(ownerVisibleUserIds.filter(id => salesUsers.has(id))),
    assignees: new Set(assignmentVisibleUserIds.filter(id => salesUsers.has(id))),
  };
}

export function matchesNotInterestedScope(lead: Attribution, scope: LeadScope): boolean {
  return scope.owners.has(lead.ownerId) || Boolean(lead.assignedToId && scope.assignees.has(lead.assignedToId));
}

export async function getLatestNotInterestedEvents(databases: Databases, leadIds: string[]) {
  const events = await listAllDocuments<NotInterestedLeadEvent>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
    queries: [Query.equal('leadId', leadIds), Query.orderDesc('markedAt'), Query.orderDesc('$id')],
    requireComplete: true,
  });
  const latest = new Map<string, NotInterestedLeadEvent>();
  for (const event of events) {
    if (!latest.has(event.leadId)) latest.set(event.leadId, event);
  }
  return latest;
}

export function getNotInterestedAttribution(lead: Lead, latest?: NotInterestedLeadEvent) {
  const holdingOwner = getUnassignedOwnerId();
  const statusChange = parseLeadHistory(lead.history).reverse().find(entry =>
    entry.changes.status && normalizeLeadStatus(entry.changes.status.to) !== normalizeLeadStatus(entry.changes.status.from));
  const closure = normalizeLeadStatus(statusChange?.changes.status?.to) === 'notinterested' ? statusChange : undefined;
  const formerOwner = closure?.changes.ownerId?.from;
  const formerAssignee = closure?.changes.assignedToId?.from;
  const event = latest && (!latest.status || latest.status === 'active') &&
    (!closure || !lead.closedAt || Date.parse(latest.markedAt) >= Date.parse(lead.closedAt))
    ? latest : undefined;
  const recordedOwner = event?.previousOwnerId;

  return {
    ownerId: recordedOwner && recordedOwner !== holdingOwner
      ? recordedOwner
      : typeof formerOwner === 'string' ? formerOwner : lead.ownerId,
    assignedToId: event && recordedOwner !== holdingOwner
      ? event.previousAssignedToId ?? null
      : event?.previousAssignedToId ?? (typeof formerAssignee === 'string' ? formerAssignee : lead.assignedToId),
    markedAt: lead.closedAt || event?.markedAt || closure?.occurredAt || lead.$updatedAt,
  };
}
