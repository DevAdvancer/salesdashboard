import type { ClientPaymentPlan, Lead, LeadData } from '@/lib/types';

export interface LeadLifecycleEvent {
  id: string;
  type: 'closed' | 'reopened' | 'updated';
  createdAt: string;
  actorId: string;
  actorName: string;
  status: string;
  previousStatus: string;
  previousClosedAt: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export function getLeadLifecycleEvents(data: LeadData): LeadLifecycleEvent[] {
  if (!Array.isArray(data.lifecycleHistory)) return [];
  const history: unknown[] = data.lifecycleHistory;
  return history.filter((event): event is LeadLifecycleEvent => {
    if (!event || typeof event !== 'object') return false;
    const row = event as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.createdAt === 'string' &&
      (row.type === 'closed' || row.type === 'reopened' || row.type === 'updated');
  });
}

export function recordLeadLifecycleEvent(
  lead: Lead, type: LeadLifecycleEvent['type'], actorId: string,
  actorName: string, status: string, now: string, id: string,
): LeadData {
  // Fail before changing state if the business data cannot be preserved.
  const data: LeadData = JSON.parse(lead.data || '{}');
  const events = getLeadLifecycleEvents(data);
  return {
    ...data,
    ...(type === 'reopened' ? { paymentCycleId: id } : {}),
    lifecycleHistory: [...events, {
      id, type, actorId, actorName, createdAt: now, status,
      previousStatus: lead.status, previousClosedAt: lead.closedAt ?? null,
    }],
  };
}

/** Keep saved edits in the same durable history as the reopened payment cycle. */
export function recordReopenedLeadChanges(
  lead: Lead, nextData: LeadData, actorId: string, actorName: string, now: string, id: string, metadata: Partial<Lead> = {},
): LeadData {
  const previous: LeadData = JSON.parse(lead.data || '{}');
  const history = getLeadLifecycleEvents(previous);
  // These fields are server-owned, including when no edit event is needed.
  const result = { ...nextData };
  for (const key of ['lifecycleHistory', 'paymentCycleId']) {
    if (key in previous) result[key] = previous[key];
    else delete result[key];
  }
  if (!history.some(event => event.type === 'reopened')) return result;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(result)])) {
    if (key === 'lifecycleHistory' || key === 'paymentCycleId') continue;
    if (JSON.stringify(previous[key]) !== JSON.stringify(result[key])) {
      changes[key] = { from: previous[key] ?? null, to: result[key] ?? null };
    }
  }
  for (const key of Object.keys(metadata) as Array<keyof Lead>) {
    if (JSON.stringify(lead[key]) !== JSON.stringify(metadata[key])) {
      changes[key] = { from: lead[key] ?? null, to: metadata[key] ?? null };
    }
  }
  if (!Object.keys(changes).length) return result;
  result.lifecycleHistory = [...history, {
    id, type: 'updated', actorId, actorName, createdAt: now,
    status: String(result.status || lead.status), previousStatus: lead.status,
    previousClosedAt: lead.closedAt ?? null, changes,
  }];
  return result;
}

export function getReopenedLeadMetadataPatch(
  lead: Lead, metadata: Partial<Lead>, actorId: string, actorName: string, now: string, id: string,
): { data?: string } {
  const previous: LeadData = JSON.parse(lead.data || '{}');
  const next = recordReopenedLeadChanges(lead, previous, actorId, actorName, now, id, metadata);
  return JSON.stringify(next.lifecycleHistory) === JSON.stringify(previous.lifecycleHistory)
    ? {} : { data: JSON.stringify(next) };
}

export function getPaymentCycleId(data: LeadData): string {
  return typeof data.paymentCycleId === 'string' ? data.paymentCycleId : 'initial';
}

/** Closure snapshots keep earlier cycles attributed to their original date/agent. */
export function snapshotPaymentPlan(plan: ClientPaymentPlan, lead: Lead, data: LeadData, now: string): ClientPaymentPlan {
  return {
    ...plan,
    cycleId: getPaymentCycleId(data),
    closure: {
      closedAt: now,
      ownerId: lead.ownerId,
      assignedToId: lead.assignedToId ?? null,
      branchId: lead.branchId ?? null,
      leadAmount: Number(data.leadAmount ?? data.totalAmount ?? data.amount) || 0,
    },
  };
}

export function latestPaymentIdsByLead(docs: Array<{ $id: string; leadId: string; createdAt?: string }>): Map<string, string> {
  const latest = new Map<string, typeof docs[number]>();
  for (const doc of docs) {
    const previous = latest.get(doc.leadId);
    if (!previous || (doc.createdAt ?? '') > (previous.createdAt ?? '')) latest.set(doc.leadId, doc);
  }
  return new Map([...latest].map(([leadId, doc]) => [leadId, doc.$id]));
}

export function isCurrentPaymentCycle(plan: ClientPaymentPlan, data: LeadData): boolean {
  return (plan.cycleId ?? 'initial') === getPaymentCycleId(data);
}

export function getPaymentCycleAttribution(payment: Record<string, unknown>, lead: Record<string, unknown>) {
  let plan = {} as ClientPaymentPlan;
  let data: LeadData = {};
  try { plan = JSON.parse(String(payment.paymentPlan ?? payment.paymentPlanJson ?? '{}')); } catch {}
  try { data = JSON.parse(String(lead.data ?? '{}')); } catch {}
  const isCurrent = isCurrentPaymentCycle(plan, data);
  return {
    ownerId: plan.closure?.ownerId ?? lead.ownerId as string | undefined,
    assignedToId: plan.closure ? (plan.closure.assignedToId ?? undefined) : lead.assignedToId as string | undefined,
    closedAt: plan.closure?.closedAt ?? (isCurrent ? lead.closedAt : payment.createdAt) as string | undefined,
    isCurrent,
  };
}
