import type { ClientPaymentPlan, Lead, LeadData } from '@/lib/types';

export interface LeadLifecycleEvent {
  id: string;
  type: 'closed' | 'reopened';
  createdAt: string;
  actorId: string;
  actorName: string;
  status: string;
  previousStatus: string;
  previousClosedAt: string | null;
}

export function getLeadLifecycleEvents(data: LeadData): LeadLifecycleEvent[] {
  if (!Array.isArray(data.lifecycleHistory)) return [];
  const history: unknown[] = data.lifecycleHistory;
  return history.filter((event): event is LeadLifecycleEvent => {
    if (!event || typeof event !== 'object') return false;
    const row = event as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.createdAt === 'string' &&
      (row.type === 'closed' || row.type === 'reopened');
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
