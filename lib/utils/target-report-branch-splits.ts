import type { User, ClientPaymentPlan } from '@/lib/types';
import type { TargetReportResult } from '@/lib/utils/monthly-target-report';
import { getPrimaryBranchId } from '@/lib/utils/user-branches';
import { paymentReportingBranch } from '@/lib/utils/lead-closing-branch';
import { paymentBusinessDate, targetUpfrontAmounts } from '@/lib/utils/target-payment-attribution';
import { followupPaymentRecipient } from '@/lib/utils/followup-payment-attribution';
import { getFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';

type Doc = Record<string, unknown>;
function planOf(payment: Doc): ClientPaymentPlan {
  try { return JSON.parse(String(payment.paymentPlan ?? payment.paymentPlanJson ?? '{}')); } catch { return {} as ClientPaymentPlan; }
}

/** Keep person/team totals intact while allocating each receipt to its reporting branch. */
export function targetReportBranchSplits(input: {
  result: TargetReportResult; users: Map<string, User>; branches: Map<string, string>;
  payments: Doc[]; leads: Map<string, Doc>; followups: Doc[];
  contributorIds: Set<string>; from: string; to: string;
}) {
  const totals = new Map([...input.branches.keys()].map(id => [id, 0]));
  const visible = new Set<string>();
  const add = (branch: string | null, amount: number) => {
    const key = branch || '';
    totals.set(key, (totals.get(key) || 0) + amount);
  };
  const primary = (id: unknown) => typeof id === 'string' && input.users.has(id) ? getPrimaryBranchId(input.users.get(id)!) : null;
  for (const row of input.result.rows) for (const agent of row.agents) {
    visible.add(agent.userId);
    add(primary(agent.userId), agent.achieved);
  }
  const reportingBranch = (payment: Doc, lead: Doc) => {
    const plan = planOf(payment);
    return paymentReportingBranch(plan.closure, primary(plan.closure?.ownerId || lead.ownerId));
  };
  for (const payment of input.payments) {
    const lead = input.leads.get(String(payment.leadId)) || {};
    for (const [id, amount] of targetUpfrontAmounts({ payment, lead, from: input.from, to: input.to,
      contributorIds: input.contributorIds, followups: input.followups })) {
      if (!visible.has(id)) continue;
      add(primary(id), -amount);
      add(reportingBranch(payment, lead), amount);
    }
  }
  for (const receipt of input.followups) {
    const date = paymentBusinessDate(receipt.date);
    if (!date || date < input.from || date > input.to) continue;
    const lead = input.leads.get(String(receipt.leadId));
    const id = followupPaymentRecipient(receipt, lead);
    if (!visible.has(id) || !lead) continue; // Independent payments retain the credited profile's primary branch.
    const cycles = input.payments.filter(payment => payment.leadId === receipt.leadId);
    const sourceCycle = cycles.find(payment => {
      try { return JSON.parse(String(payment.updates ?? payment.updatesJson ?? '[]')).some((update: { sourceFollowupId?: string }) => update.sourceFollowupId === receipt.$id); } catch { return false; }
    });
    const datedCycle = cycles.filter(payment => paymentBusinessDate(planOf(payment).closure?.closedAt || payment.createdAt) <= date)
      .sort((a, b) => String(planOf(b).closure?.closedAt || b.createdAt).localeCompare(String(planOf(a).closure?.closedAt || a.createdAt)))[0];
    const cycle = sourceCycle || datedCycle;
    const amount = getFollowupsPaymentAmount(receipt);
    add(primary(id), -amount);
    add(cycle ? reportingBranch(cycle, lead) : primary(lead.ownerId), amount);
  }
  return [...totals].map(([branchId, amount]) => ({ branchId, branchName: input.branches.get(branchId) || (branchId ? branchId : 'Unassigned'), amount }));
}
