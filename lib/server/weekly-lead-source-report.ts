import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { linkedinReportUtcBounds } from '@/lib/server/linkedin-report-requests';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { normalizeLeadStatus } from '@/lib/utils/lead-status-workflow';
import type { Lead, NotInterestedLeadEvent } from '@/lib/types';
import type { createAdminClient } from '@/lib/server/appwrite';

type Outcome = { leadId: string; agentId: string; markedAt: string };
type LinkedinActivity = { leadId: string; agentId: string; generated: boolean; notInterested: boolean };
type WeeklySourceFacts = { linkedin: LinkedinActivity[]; notInterested: Outcome[] };
type Range = { startDate: string; endDate: string };

function fields(lead: Lead): Record<string, unknown> {
  try {
    const data = JSON.parse(lead.data);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function inEasternRange(value: string | null | undefined, range: Range) {
  if (!value) return false;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return false;
  const date = getCurrentEasternIsoDate(time);
  return date >= range.startDate && date <= range.endDate;
}

/** Derive historical source counts without rewriting leads, event history or daily stats. */
export function buildWeeklyLeadSourceFacts(input: Range & {
  leads: Lead[]; events: NotInterestedLeadEvent[]; unassignedOwnerId?: string;
}): WeeklySourceFacts {
  const events = [...new Map(input.events.map(event => [event.$id, event])).values()];
  const leadById = new Map(input.leads.map(lead => [lead.$id, lead]));
  const usableUser = (id: unknown) => text(id) !== input.unassignedOwnerId ? text(id) : '';
  const notInterested: Outcome[] = [];
  for (const event of events) {
    if (event.status && event.status !== 'active') continue;
    const lead = leadById.get(event.leadId);
    const data = lead ? fields(lead) : {};
    // Old synthetic backfills copied the holding user and $updatedAt after the
    // lead was moved. Recover recorded closure facts rather than crediting it.
    const synthetic = Boolean(input.unassignedOwnerId && event.markedById === input.unassignedOwnerId);
    const markedAt = synthetic && lead && normalizeLeadStatus(lead.status) === 'notinterested'
      ? lead.closedAt || event.markedAt : event.markedAt;
    if (!inEasternRange(markedAt, input)) continue;
    notInterested.push({ leadId: event.leadId, markedAt,
      agentId: usableUser(event.previousAssignedToId) || usableUser(event.previousOwnerId) ||
        usableUser(data.closedById) || usableUser(data.creatorId) || usableUser(event.markedById) || event.previousOwnerId });
  }
  const eventsByLead = new Map<string, NotInterestedLeadEvent[]>();
  for (const event of events) {
    const history = eventsByLead.get(event.leadId) ?? [];
    history.push(event);
    eventsByLead.set(event.leadId, history);
  }
  const linkedin: LinkedinActivity[] = [];
  for (const lead of leadById.values()) {
    const data = fields(lead);
    const history = (eventsByLead.get(lead.$id) ?? []).sort((a, b) => a.markedAt.localeCompare(b.markedAt));
    // Legacy rows may predate the event table. Use only a recorded closure date;
    // an ordinary update timestamp cannot establish when the status changed.
    if (!history.length && normalizeLeadStatus(lead.status) === 'notinterested' &&
      inEasternRange(lead.closedAt, input)) {
      notInterested.push({ leadId: lead.$id,
        agentId: usableUser(data.closedById) || usableUser(data.creatorId) || usableUser(lead.assignedToId) || lead.ownerId,
        markedAt: lead.closedAt! });
    }
    const source = (text(data.sourceName) || text(data.source)).toLowerCase().replace(/[^a-z0-9]/g, '');
    // A saved profile URL alone does not establish acquisition source.
    if (!source.includes('linkedin')) continue;
    const creatorId = text(data.creatorId) || history[0]?.previousOwnerId || lead.ownerId;
    if (inEasternRange(lead.$createdAt, input)) {
      linkedin.push({ leadId: lead.$id, agentId: creatorId, generated: true, notInterested: false });
    }
    for (const outcome of notInterested.filter(outcome => outcome.leadId === lead.$id)) {
      linkedin.push({ leadId: lead.$id, agentId: outcome.agentId, generated: false, notInterested: true });
    }
  }
  return { linkedin, notInterested };
}

/** Apply the Weekly Report's existing user scope before returning per-agent totals. */
export function summarizeWeeklyLeadSources(facts: WeeklySourceFacts, visibleUserIds: Set<string>) {
  const totals = new Map<string, { linkedinLeads: number; linkedinNotInterested: number; notInterested: number }>();
  const row = (agentId: string) => {
    const value = totals.get(agentId) ?? { linkedinLeads: 0, linkedinNotInterested: 0, notInterested: 0 };
    totals.set(agentId, value);
    return value;
  };
  const countedOutcomes = new Set<string>();
  for (const outcome of facts.notInterested) {
    if (!visibleUserIds.has(outcome.agentId) || countedOutcomes.has(outcome.leadId)) continue;
    countedOutcomes.add(outcome.leadId);
    row(outcome.agentId).notInterested++;
  }
  const generated = new Set<string>();
  const notInterested = new Set<string>();
  for (const activity of facts.linkedin) {
    if (!visibleUserIds.has(activity.agentId)) continue;
    if (activity.generated && !generated.has(activity.leadId)) {
      generated.add(activity.leadId);
      row(activity.agentId).linkedinLeads++;
    }
    if (activity.notInterested && !notInterested.has(activity.leadId)) {
      notInterested.add(activity.leadId);
      row(activity.agentId).linkedinNotInterested++;
    }
  }
  return totals;
}

export async function loadWeeklyLeadSourceFacts(input: Range & {
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'];
}) {
  const { startUtc, endUtcExclusive } = linkedinReportUtcBounds(input.startDate, input.endDate);
  const db = input.databases;
  for (const collection of [COLLECTIONS.LEADS, COLLECTIONS.NOT_INTERESTED_LEADS]) db.clearReadCacheForCollection?.(collection);
  const read = <T>(collectionId: string, queries: string[]) => listAllDocuments<T>({
    databases: db, databaseId: DATABASE_ID, collectionId, queries: [...queries, Query.orderAsc('$id')],
  });
  const select = Query.select(['$id', '$createdAt', 'closedAt', 'status', 'data', 'ownerId', 'assignedToId']);
  const [created, closed, marked] = await Promise.all([
    read<Lead>(COLLECTIONS.LEADS, [Query.greaterThanEqual('$createdAt', startUtc), Query.lessThan('$createdAt', endUtcExclusive), select]),
    read<Lead>(COLLECTIONS.LEADS, [Query.greaterThanEqual('closedAt', startUtc), Query.lessThan('closedAt', endUtcExclusive), select]),
    read<NotInterestedLeadEvent>(COLLECTIONS.NOT_INTERESTED_LEADS, [Query.greaterThanEqual('markedAt', startUtc), Query.lessThan('markedAt', endUtcExclusive)]),
  ]);
  const leads = new Map([...created, ...closed].map(lead => [lead.$id, lead]));
  const missing = [...new Set(marked.map(event => event.leadId).filter(id => !leads.has(id)))];
  for (let index = 0; index < missing.length; index += 100) {
    for (const lead of await read<Lead>(COLLECTIONS.LEADS, [Query.equal('$id', missing.slice(index, index + 100)), select])) leads.set(lead.$id, lead);
  }
  // Include prior/reopened events even outside the range, so they cannot be
  // mistaken for a legacy lead with no event history.
  const events = new Map(marked.map(event => [event.$id, event]));
  const leadIds = [...leads.keys()];
  for (let index = 0; index < leadIds.length; index += 100) {
    for (const event of await read<NotInterestedLeadEvent>(COLLECTIONS.NOT_INTERESTED_LEADS,
      [Query.equal('leadId', leadIds.slice(index, index + 100))])) events.set(event.$id, event);
  }
  return buildWeeklyLeadSourceFacts({ ...input, leads: [...leads.values()], events: [...events.values()],
    unassignedOwnerId: process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID || process.env.APPWRITE_UNASSIGNED_OWNER_ID });
}
