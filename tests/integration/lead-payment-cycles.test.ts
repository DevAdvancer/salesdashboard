import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Lead } from '@/lib/types';
import { getPaymentCycleAttribution, recordLeadLifecycleEvent } from '@/lib/utils/lead-payment-cycle';
import { createPreviousFollowupsPaymentAction } from '@/app/actions/previous-followups-payments';
import { FOLLOWUPS_PAYMENT_COMPANIES } from '@/lib/types';
import { getClientPaymentRecordAction, upsertClientPaymentRecordAction, addClientPaymentUpdateAction } from '@/app/actions/client-payments/record';
import { listClientPaymentSummariesAction } from '@/app/actions/client-payments/list';
import { listPaymentsReportAction } from '@/app/actions/client-payments/insights';

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
  if (mockDocs.has(id)) throw Object.assign(new Error('Conflict'), { code: 409 });
  const doc = { ...payload, $id: id, $createdAt: payload.createdAt };
  mockDocs.set(id, doc);
  return doc;
});
const mockUpdateDocument = jest.fn(async (_db, collection, id, payload) => {
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
        ? Boolean(d.paymentPlan) : collection === COLLECTIONS.LEADS ? Boolean(d.data) : Boolean(d.role));
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

  it('records only the signed adjustment when a followup payment is edited or refunded', async () => {
    await upsertClientPaymentRecordAction(input);
    const update = { actorId: 'admin', leadId: 'lead', status: 'fully_paid' as const, amount: 200, sourceFollowupId: 'followup-1' };
    await addClientPaymentUpdateAction(update);
    await addClientPaymentUpdateAction(update);
    expect(JSON.parse(payments()[0].updates)).toHaveLength(2);
    const refunded = await addClientPaymentUpdateAction({ ...update, status: 'refunded', amount: -200 });
    expect(refunded.updates[0].amount).toBe(-400);
    expect(refunded.updates.reduce((sum, u) => sum + (u.amount ?? 0), 0)).toBe(1400);
  });

  it('persists an explicit refund status and negative amount on a followup row', async () => {
    const row = await createPreviousFollowupsPaymentAction({ actorId: 'admin',
      company: FOLLOWUPS_PAYMENT_COMPANIES[0], candidateName: 'Client', amount: 200,
      date: '2026-10-19', status: 'refunded' });
    expect(row).toMatchObject({ amount: -200, status: 'refunded' });
  });

  it('keeps the original closure date and assignee when the lead is later reassigned', () => {
    const attribution = getPaymentCycleAttribution({ paymentPlan: JSON.stringify({
      closure: { closedAt: '2026-08-25T20:00:00Z', ownerId: 'old-owner', assignedToId: null },
    }) }, { ownerId: 'new-owner', assignedToId: 'new-agent', closedAt: '2026-10-19T16:00:00Z', data: '{"paymentCycleId":"second"}' });
    expect(attribution).toMatchObject({ ownerId: 'old-owner', assignedToId: undefined,
      closedAt: '2026-08-25T20:00:00Z', isCurrent: false });
  });
});
