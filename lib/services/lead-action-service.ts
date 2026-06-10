import {
  createLeadAction,
  listLeadsAction,
  reopenLeadAction,
  updateLeadAction,
} from "@/app/actions/lead";
import {
  assignLeadAction,
  backoutLeadAction,
  closeLeadAction,
  listLeadAssignableAgentsAction,
  notInterestedLeadAction,
} from "@/lib/actions/lead-actions";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { CreateLeadInput, Lead, LeadData, LeadListFilters, User, UserRole } from "@/lib/types";

const LEAD_READ_SCOPE_PREFIX = "lead:";
const LEAD_LIST_TTL_MS = 60 * 1000;

/** Return type from listLeadsPaginated. */
export type PaginatedLeads = {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
};

export function clearLeadReadCache() {
  clearClientReadCache(LEAD_READ_SCOPE_PREFIX);
}

/**
 * List leads and return the full filtered set as a flat array.
 * Use this when you need every lead (e.g. counts, exports).
 * For paginated UIs, prefer `listLeadsPaginated`.
 */
export function listLeads(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  return cacheClientRead(
    `${LEAD_READ_SCOPE_PREFIX}listLeads`,
    [filters, userId, userRole, branchIds ?? []],
    () => listLeadsAction(filters, userId, userRole, branchIds, { forExport: true }).then(r => r.leads),
    LEAD_LIST_TTL_MS
  );
}

/**
 * List a single page of leads plus total count for pagination UI.
 * Bypasses the client-side cache because each page request is unique
 * (filters + page + pageSize are part of the cache key).
 */
export function listLeadsPaginated(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds: string[] | undefined,
  options: { page: number; pageSize: number }
): Promise<PaginatedLeads> {
  return listLeadsAction(
    filters,
    userId,
    userRole,
    branchIds,
    { page: options.page, pageSize: options.pageSize }
  );
}

/**
 * List all leads for export (bypasses pagination, capped at 10K).
 */
export function listLeadsForExport(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  return listLeadsAction(
    filters,
    userId,
    userRole,
    branchIds,
    { forExport: true }
  ).then((r) => r.leads);
}

export function createLead(
  ownerId: string,
  input: CreateLeadInput,
  creatingUserId?: string,
  creatingUserName?: string
): Promise<Lead> {
  return createLeadAction(ownerId, input, creatingUserId, creatingUserName).finally(
    clearLeadReadCache
  );
}

export function reopenLead(
  leadId: string,
  actorId?: string,
  actorName?: string
): Promise<Lead> {
  return reopenLeadAction(leadId, actorId, actorName).finally(clearLeadReadCache);
}

export function updateLead(
  leadId: string,
  data: Partial<LeadData>,
  actorId: string,
  actorName?: string
): Promise<Lead> {
  return updateLeadAction(leadId, data, actorId, actorName).finally(clearLeadReadCache);
}

export function assignLead(
  leadId: string,
  agentId: string,
  actorId: string,
  actorName: string
): Promise<{ success: boolean; lead: Lead }> {
  return assignLeadAction(leadId, agentId, actorId, actorName).finally(clearLeadReadCache);
}

export function listLeadAssignableAgents(
  leadId: string,
  actorId: string
): Promise<User[]> {
  return listLeadAssignableAgentsAction(leadId, actorId);
}

export function backoutLead(
  leadId: string,
  actorId: string,
  actorName: string
): Promise<{ success: boolean; lead: Lead }> {
  return backoutLeadAction(leadId, actorId, actorName).finally(clearLeadReadCache);
}

export function notInterestedLead(
  leadId: string,
  actorId: string,
  actorName: string
): Promise<{ success: boolean; lead: Lead }> {
  return notInterestedLeadAction(leadId, actorId, actorName).finally(clearLeadReadCache);
}

export function closeLead(
  leadId: string,
  closedStatus: string,
  actorId: string,
  actorName: string,
  actorRole?: UserRole
): Promise<{ success: boolean; lead: Lead }> {
  return closeLeadAction(leadId, closedStatus, actorId, actorName, actorRole).finally(clearLeadReadCache);
}
