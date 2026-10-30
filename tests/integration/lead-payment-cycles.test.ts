import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Lead } from '@/lib/types';
import { getPaymentCycleAttribution, recordLeadLifecycleEvent } from '@/lib/utils/lead-payment-cycle';
import { createPreviousFollowupsPaymentAction, updatePreviousFollowupsPaymentAction, listPreviousFollowupsPaymentsAction } from '@/app/actions/previous-followups-payments';
import { FOLLOWUPS_PAYMENT_COMPANIES } from '@/lib/types';
import { getClientPaymentRecordAction, upsertClientPaymentRecordAction, addClientPaymentUpdateAction } from '@/app/actions/client-payments/record';
import { listClientPaymentSummariesAction, listLeadPaidAmountsAction } from '@/app/actions/client-payments/list';
import { listPaymentsReportAction, listAllPaymentInsightsAction } from '@/app/actions/client-payments/insights';

const mockDocs = new Map<string, any>();
jest.mock('node-appwrite', () => ({
  ID: { unique: () => 'unique' },
  Query: {
    equal: (attribute, value) => JSON.stringify({ method: 'equal', attribute, values: Array.isArray(value) ? value : [value] }),
    orderDesc: attribute => JSON.stringify({ method: 'orderDesc', attribute }),
    limit: value => JSON.stringify({ method: 'limit', values: [value] }),
    select: value => JSON.stringify({ method: 'select', values: value }),
  },
}));
const mockCreateDocument = jest.fn(async (_db, collection, id, payload) => {
  if (collection === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS && payload.amount < 0) throw new Error('Appwrite amount must be nonnegative');
  if (mockDocs.has(id)) throw Object.assign(new Error('Conflict'), { code: 409 });
  const doc = { ...payload, $id: id, $createdAt: payload.createdAt };
  mockDocs.set(id, doc);
  return doc;
});
const mockUpdateDocument = jest.fn(async (_db, collection, id, payload) => {
  if (collection === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS && payload.amount < 0) throw new Error('Appwrite amount must be nonnegative');
  const doc = { ...mockDocs.get(id), ...payload };
  mockDocs.set(id, doc);
  return doc;
});
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/app/actions/pending-amounts', () => ({ upsertPendingAmountAction: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: async () => ({ databases: {
    getDocument: async (_db, _collection, id) => mockDocs.get(id),
    createDocument: (...args) => mockCreateDocument(...args),
    updateDocument: (...args) => mockUpdateDocument(...args),
    listDocuments: async (_db, collection, rawQueries) => {
      const queries = rawQueries.map(q => JSON.parse(q));
      let rows = [...mockDocs.values()].filter(d => collection === COLLECTIONS.CLIENT_PAYMENTS
        ? Boolean(d.paymentPlan) : collection === COLLECTIONS.LEADS ? Boolean(d.data) : collection === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS ? typeof d.amount === 'number' : Boolean(d.role));
      for (const q of queries) {
        if (q.method === 'equal') rows = rows.filter(d => q.values.includes(d[q.attribute]));
        if (q.method === 'orderDesc') rows.sort((a, b) => String(b[q.attribute]).localeCompare(String(a[q.attribute])));
      }
      const limit = queries.find(q => q.method === 'limit')?.values[0] ?? 100;
      return { documents: rows.slice(0, limit) };
    },
  } }),
}));

describe('closure payment cycles', () => {
  const input = { actorId: 'admin', leadId: 'lead', personalDetails: { legalName: 'Client' },
    paymentPlan: { percent: 12, months: 4, upfrontAmount: 1600 }, initialStatus: 'fully_paid' as const };
  const payments = () => [...mockDocs.values()].filter(d => d.paymentPlan);

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocs.clear();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T20:39:47Z'));
    mockDocs.set('admin', { $id: 'admin', name: 'Admin', role: 'admin' });
    mockDocs.set('lead', { $id: 'lead', ownerId: 'admin', assignedToId: 'admin', isClosed: false,
      status: 'Interested', data: JSON.stringify({ firstName: 'Client', leadAmount: 1600 }), closedAt: null });
  });
  afterEach(() => jest.useRealTimers());

  async function reopen() {
    const lead = mockDocs.get('lead') as Lead;
    const data = recordLeadLifecycleEvent(lead, 'reopened', 'admin', 'Admin', 'Reopened', new Date().toISOString(), 'cycle-two');
    mockDocs.set('lead', { ...lead, status: 'Reopened', isClosed: false, data: JSON.stringify(data) });
  }

  it('preserves the first payment, creates a new row and initial payment for the next closure, and updates only the latest cycle', async () => {
    const first = await upsertClientPaymentRecordAction(input);
    const original = JSON.stringify(mockDocs.get(first.$id));
    mockDocs.set('lead', { ...mockDocs.get('lead'), isClosed: true, status: 'Won', closedAt: '2026-08-25T20:39:47Z' });
    jest.setSystemTime(new Date('2026-10-19T16:17:32Z'));
    await reopen();
    const second = await upsertClientPaymentRecordAction({ ...input, paymentPlan: { ...input.paymentPlan, upfrontAmount: 1500 } });
    expect(second.$id).not.toBe(first.$id);
    expect(payments()).toHaveLength(2);
    expect(JSON.stringify(mockDocs.get(first.$id))).toBe(original);
    expect(second.updates).toHaveLength(1);
    expect(second.updates[0].amount).toBe(1500);

    // A retry must not create another row or duplicate the initial payment.
    await upsertClientPaymentRecordAction({ ...input, paymentPlan: second.paymentPlan });
    expect(payments()).toHaveLength(2);
    expect(JSON.parse(mockDocs.get(second.$id).updates)).toHaveLength(1);

    await addClientPaymentUpdateAction({ actorId: 'admin', leadId: 'lead', status: 'refunded', amount: -1500 });
    expect(mockDocs.get(first.$id).status).toBe('fully_paid');
    expect(mockDocs.get(second.$id).status).toBe('refunded');
    const history = await getClientPaymentRecordAction('admin', 'lead');
    expect(history?.previousRecords?.[0].$id).toBe(first.$id);
    expect(history?.lifecycleEvents?.[0]).toMatchObject({ type: 'reopened', actorId: 'admin', previousClosedAt: '2026-08-25T20:39:47Z' });
    const summaries = await listClientPaymentSummariesAction({ actorId: 'admin', leadIds: ['lead'] });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe('refunded');

    const rows = await listPaymentsReportAction({ actorId: 'admin' });
    expect(rows.find(r => r.$id === first.$id)).toMatchObject({ totalPaid: 1600, closedAt: '2026-08-25T20:39:47.000Z' });
    expect(rows.find(r => r.$id === second.$id)).toMatchObject({ totalPaid: 0, closedAt: '2026-10-19T16:17:32.000Z' });
  });

  it('creates just one record when two requests initialize the same closure concurrently', async () => {
    const [a, b] = await Promise.all([upsertClientPaymentRecordAction(input), upsertClientPaymentRecordAction(input)]);
    expect(a.$id).toBe(b.$id);
    expect(payments()).toHaveLength(1);
    expect(JSON.parse(payments()[0].updates)).toHaveLength(1);
  });

  it('reads linked follow-up history across all dates without changing payment totals or cycles', async () => {
    const record = await upsertClientPaymentRecordAction(input);
    const original = JSON.stringify(mockDocs.get(record.$id));
    mockDocs.set('followup-old', { $id: 'followup-old', leadId: 'lead', amount: 0, status: 'paid',
      paymentRemark: 'Waiting for interview before payment', createdById: 'admin', createdByName: 'Admin',
      createdAt: '2025-01-01T14:00:00Z', date: '2025-01-01' });
    mockDocs.set('followup-other', { $id: 'followup-other', leadId: 'other-lead', amount: 100,
      status: 'paid', paymentRemark: 'Private other client note' });
    const history = await getClientPaymentRecordAction('admin', 'lead');
    expect(history?.followupUpdates).toEqual([expect.objectContaining({
      id: 'followup-old', amount: 0, note: 'Waiting for interview before payment', actorName: 'Admin',
    })]);
    expect(history?.updates).toEqual(record.updates);
    expect(history?.status).toBe('fully_paid');
    expect(JSON.stringify(mockDocs.get(record.$id))).toBe(original);
  });

  it('records only the signed adjustment when a followup payment is edited or refunded', async () => {
    await upsertClientPaymentRecordAction(input);
    mockDocs.set('followup-1', { $id: 'followup-1', leadId: 'lead', amount: 200, date: '2026-08-20' });
    const update = { actorId: 'admin', leadId: 'lead', status: 'fully_paid' as const, amount: 200, sourceFollowupId: 'followup-1' };
    await addClientPaymentUpdateAction(update);
    await addClientPaymentUpdateAction(update);
    expect(JSON.parse(payments()[0].updates)).toHaveLength(2);
    mockDocs.set('followup-1', { ...mockDocs.get('followup-1'), status: 'refunded' });
    const refunded = await addClientPaymentUpdateAction({ ...update, status: 'refunded', amount: -200 });
    expect(refunded.updates[0].amount).toBe(-400);
    expect(refunded.updates[0].paymentDate).toBe('2026-08-20');
    expect(refunded.updates.reduce((sum, u) => sum + (u.amount ?? 0), 0)).toBe(1400);
  });

  it('creates BGC without a lead or client payment and keeps its category when edited', async () => {
    const row = await createPreviousFollowupsPaymentAction({ actorId: 'admin', category: 'bgc',
      company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Independent profile', amount: 300,
      date: '2026-08-20', status: 'paid' });
    expect(row).toMatchObject({ category: 'bgc', leadId: 'manual_followup:bgc:unique', creditedAgentId: 'admin', amount: 300 });
    expect(payments()).toHaveLength(0);
    const edited = await updatePreviousFollowupsPaymentAction({ actorId: 'admin', paymentId: row.$id, amount: 150 });
    expect(edited).toMatchObject({ category: 'bgc', leadId: row.leadId, amount: 150 });
    const history = await listPreviousFollowupsPaymentsAction({ actorId: 'admin' });
    expect(history).toEqual([expect.objectContaining({ $id: row.$id, date: '2026-08-20' })]);
  });

  it('stores a nonnegative refund magnitude and returns the signed amount', async () => {
    const row = await createPreviousFollowupsPaymentAction({ actorId: 'admin',
      company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Client', amount: 200,
      date: '2026-10-19', status: 'refunded' });
    expect(row).toMatchObject({ amount: -200, status: 'refunded' });
    expect(mockDocs.get(row.$id)).toMatchObject({ amount: 200, status: 'refunded' });
  });

  it('credits the assigned profile when an admin records a client followup and preserves the actual audit actor', async () => {
    mockDocs.set('pankaj', { $id: 'pankaj', name: 'Pankaj Rajput', role: 'agent', department: 'sales' });
    mockDocs.set('lead', { ...mockDocs.get('lead'), assignedToId: 'pankaj' });
    await upsertClientPaymentRecordAction(input);
    const followup = await createPreviousFollowupsPaymentAction({ actorId: 'admin', leadId: 'lead',
      company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Client', amount: 800, date: '2026-07-10',
      creditedAgentId: null, status: 'paid' });
    expect(followup).toMatchObject({ creditedAgentId: 'pankaj', createdById: 'admin', createdByName: 'Admin' });
    await addClientPaymentUpdateAction({ actorId: 'admin', leadId: 'lead', amount: 800, status: 'fully_paid',
      sourceFollowupId: followup.$id, note: 'Followup payment added' });
    const history = await getClientPaymentRecordAction('admin', 'lead');
    expect(history?.followupUpdates?.[0]).toMatchObject({ creditedAgentId: 'pankaj', creditedAgentName: 'Pankaj Rajput', actorName: 'Admin' });
    expect(history?.updates[0]).toMatchObject({ actorId: 'admin', actorName: 'Admin' });
  });

  it('edits a refund, preserves its sign on unrelated edits, and can change it back to paid', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    try {
      const row = await createPreviousFollowupsPaymentAction({ actorId: 'admin',
        company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Client', amount: 200,
        date: '2026-10-19', status: 'paid' });
      const refund = await updatePreviousFollowupsPaymentAction({ actorId: 'admin', paymentId: row.$id, status: 'refunded', amount: -250 });
      expect(refund.amount).toBe(-250);
      expect(mockDocs.get(row.$id).amount).toBe(250);
      const edited = await updatePreviousFollowupsPaymentAction({ actorId: 'admin', paymentId: row.$id, remark: 'Refund confirmed' });
      expect(edited.amount).toBe(-250);
      const paid = await updatePreviousFollowupsPaymentAction({ actorId: 'admin', paymentId: row.$id, status: 'paid' });
      expect(paid).toMatchObject({ amount: 250, status: 'paid' });
    } finally { fetchSpy.mockRestore(); }
  });

  it('deducts a stored positive refund in payment reports', async () => {
    await upsertClientPaymentRecordAction(input);
    await createPreviousFollowupsPaymentAction({ actorId: 'admin',
      company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Client', amount: 200,
      date: '2026-10-19', status: 'refunded' });
    const rows = await listAllPaymentInsightsAction('admin');
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({
      totalPaid: -200, status: 'refunded', followupsMonthlyAmounts: { '2026-10': -200 },
    })]));
  });

  it('keeps the original closure date and assignee when the lead is later reassigned', () => {
    const attribution = getPaymentCycleAttribution({ paymentPlan: JSON.stringify({
      closure: { closedAt: '2026-08-25T20:00:00Z', ownerId: 'old-owner', assignedToId: null },
    }) }, { ownerId: 'new-owner', assignedToId: 'new-agent', closedAt: '2026-10-19T16:00:00Z', data: '{"paymentCycleId":"second"}' });
    expect(attribution).toMatchObject({ ownerId: 'old-owner', assignedToId: undefined,
      closedAt: '2026-08-25T20:00:00Z', isCurrent: false });
  });

  it('reconciles a legacy edit across history, summaries and reports, and does not append another receipt on save', async () => {
    const record = await upsertClientPaymentRecordAction(input);
    const rows = [
      { id: 'edit', status: 'fully_paid', amount: 500, note: 'Followup payment added', actorId: 'admin', actorName: 'Admin', createdAt: '2026-10-01T15:21:07Z' },
      { id: 'receipt', status: 'fully_paid', amount: 500, note: 'Followup payment added', actorId: 'alisha', actorName: 'Alisha', createdAt: '2026-10-01T14:18:34Z' },
      { id: 'initial', status: 'partially_paid', amount: 1000, note: 'Initialized', actorId: 'alisha', actorName: 'Alisha', createdAt: '2026-08-18T19:39:30Z' },
    ];
    mockDocs.set(record.$id, { ...mockDocs.get(record.$id), updates: JSON.stringify(rows), status: 'fully_paid' });
    mockDocs.set('legacy-source', { $id: 'legacy-source', leadId: 'lead', amount: 500, status: 'paid', date: '2026-09-30',
      createdAt: '2026-10-01T14:18:33Z', updatedAt: '2026-10-01T15:21:06Z', $createdAt: '2026-10-01T15:21:07Z' });
    const before = JSON.stringify(mockDocs.get(record.$id));
    const history = await getClientPaymentRecordAction('admin', 'lead');
    expect(history?.updates.reduce((sum, update) => sum + (update.amount ?? 0), 0)).toBe(1500);
    expect((await listPaymentsReportAction({ actorId: 'admin' }))[0].totalPaid).toBe(1500);
    expect((await listAllPaymentInsightsAction('admin'))[0].totalPaid).toBe(1500);
    expect((await listClientPaymentSummariesAction({ actorId: 'admin', leadIds: ['lead'] }))[0].paidAmount).toBe(1500);
    expect((await listLeadPaidAmountsAction({ actorId: 'admin', leadIds: ['lead'] })).lead).toBe(1500);
    mockUpdateDocument.mockClear();
    await addClientPaymentUpdateAction({ actorId: 'admin', leadId: 'lead', status: 'fully_paid', amount: 500, sourceFollowupId: 'legacy-source' });
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(JSON.stringify(mockDocs.get(record.$id))).toBe(before);
    jest.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    mockDocs.set('legacy-source', { ...mockDocs.get('legacy-source'), amount: 700, updatedAt: '2026-10-02T12:00:00Z' });
    const adjusted = await addClientPaymentUpdateAction({ actorId: 'admin', leadId: 'lead', status: 'fully_paid', amount: 700, sourceFollowupId: 'legacy-source' });
    expect(JSON.parse(mockDocs.get(record.$id).updates)[0]).toMatchObject({ amount: 200, sourceFollowupId: 'legacy-source' });
    expect(adjusted.updates.reduce((sum, update) => sum + (update.amount ?? 0), 0)).toBe(1700);
    expect((await listPaymentsReportAction({ actorId: 'admin' }))[0].totalPaid).toBe(1700);
  });

  it('saving an older custom-note followup after changing $598 to $600 appends only $2', async () => {
    const record = await upsertClientPaymentRecordAction(input);
    jest.setSystemTime(new Date('2026-10-14T16:43:03.202Z'));
    mockDocs.set(record.$id, { ...mockDocs.get(record.$id), status: 'fully_paid', updates: JSON.stringify([
      { id: 'receipt', actorId: 'admin', actorName: 'Admin', status: 'fully_paid', amount: 598,
        note: 'Fully Paid', createdAt: '2026-10-14T16:42:37.898Z' },
      { id: 'initial', actorId: 'admin', actorName: 'Admin', status: 'partially_paid', amount: 1000,
        note: 'Initialized', createdAt: '2026-09-21T20:59:47Z' },
    ]) });
    mockDocs.set('custom-source', { $id: 'custom-source', leadId: 'lead', amount: 600, status: 'paid',
      date: '2026-10-14', paymentRemark: 'Fully Paid', createdById: 'admin', updatedById: 'admin',
      createdAt: '2026-10-14T16:42:37.624Z', updatedAt: '2026-10-14T16:43:01.509Z' });
    const update = { actorId: 'admin', leadId: 'lead', status: 'fully_paid' as const, amount: 600,
      note: 'Fully Paid', sourceFollowupId: 'custom-source' };
    const saved = await addClientPaymentUpdateAction(update);
    expect(JSON.parse(mockDocs.get(record.$id).updates)[0].amount).toBe(2);
    expect(saved.updates.reduce((sum, item) => sum + (item.amount ?? 0), 0)).toBe(1600);
    const beforeRetry = mockUpdateDocument.mock.calls.length;
    await addClientPaymentUpdateAction(update);
    expect(mockUpdateDocument.mock.calls.length).toBe(beforeRetry);
    expect((await listPaymentsReportAction({ actorId: 'admin' }))[0].totalPaid).toBe(1600);
    expect((await listClientPaymentSummariesAction({ actorId: 'admin', leadIds: ['lead'] }))[0].paidAmount).toBe(1600);
    expect((await getClientPaymentRecordAction('admin', 'lead'))?.updates.reduce((sum, item) => sum + (item.amount ?? 0), 0)).toBe(1600);
  });
});
