import { isClientExcludedStatus } from '@/lib/utils/client-history';
import type { ClientPaymentUpdate } from '@/lib/types';
import { paymentBusinessDate } from '@/lib/utils/target-payment-attribution';

type Payment = { branchId: string | null; upfrontAmount: number; upfrontReceived?: number; leadAmount: number; followupsTotal: number | null; followupsBranchAmounts?: Record<string, number>; isFollowupOnly?: boolean; isReceiptOnly?: boolean; leadStatus: string };
export function dashboardUpfrontReceipts(updates: ClientPaymentUpdate[], from?: string | null, to?: string | null) {
  let amount = 0; let date = '';
  for (const update of updates) {
    if (update.sourceFollowupId || !['partially_paid', 'fully_paid', 'refunded'].includes(update.status) ||
      typeof update.amount !== 'number' || !Number.isFinite(update.amount)) continue;
    const day = paymentBusinessDate(update.paymentDate || update.createdAt);
    if (!day || (from && day < from.slice(0, 10)) || (to && day > to.slice(0, 10))) continue;
    amount += update.status === 'refunded' ? -Math.abs(update.amount) : update.amount;
    date = day;
  }
  return { amount, date };
}
const wholeDollars = (amount: number) => Math.round(Number.isFinite(amount) ? amount : 0);
export function dashboardPaymentAmounts(record: Payment) {
  const eligible = !record.isFollowupOnly && !isClientExcludedStatus(record.leadStatus);
  return { total: eligible && !record.isReceiptOnly ? wholeDollars(record.leadAmount || 0) : 0,
    upfront: eligible && Number.isFinite(record.upfrontReceived) ? record.upfrontReceived || 0 : 0,
    followups: Number.isFinite(record.followupsTotal) ? record.followupsTotal || 0 : 0, count: eligible && !record.isReceiptOnly ? 1 : 0 };
}

/** Uses exactly the same revenue components as the dashboard's company totals.
 * Outstanding pending_amounts are debts, never collected follow-up revenue. */
export function dashboardBranchRevenue(records: Payment[], technical: Array<{ branchId: string | null; amount: number }>, branchIds: string[]) {
  const totals = Object.fromEntries(branchIds.map(id => [id, 0]));
  let unassigned = 0;
  function add(branchId: string | null, amount: number) {
    if (branchId && Object.hasOwn(totals, branchId)) totals[branchId] += amount;
    else unassigned += amount;
  }
  for (const record of records) {
    const amounts = dashboardPaymentAmounts(record);
    add(record.branchId, amounts.upfront);
    let allocated = 0;
    for (const [branchId, amount] of Object.entries(record.followupsBranchAmounts || {})) {
      add(branchId || null, amount); allocated += amount;
    }
    add(record.branchId, amounts.followups - allocated);
  }
  for (const payment of technical) add(payment.branchId, Number(payment.amount) || 0);
  return { totals, unassigned };
}
