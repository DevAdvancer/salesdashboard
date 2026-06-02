import {
  createLeadAction,
  listLeadsAction,
  reopenLeadAction,
  updateLeadAction,
} from "@/app/actions/lead";
import {
  assignLeadAction,
  backoutLeadAction,
  notInterestedLeadAction,
} from "@/lib/actions/lead-actions";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { CreateLeadInput, Lead, LeadData, LeadListFilters, UserRole } from "@/lib/types";

const LEAD_READ_SCOPE_PREFIX = "lead:";
const LEAD_LIST_TTL_MS = 60 * 1000;

export function clearLeadReadCache() {
  clearClientReadCache(LEAD_READ_SCOPE_PREFIX);
}

export function listLeads(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  return cacheClientRead(
    `${LEAD_READ_SCOPE_PREFIX}listLeads`,
    [filters, userId, userRole, branchIds ?? []],
    () => listLeadsAction(filters, userId, userRole, branchIds),
    LEAD_LIST_TTL_MS
  );
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
