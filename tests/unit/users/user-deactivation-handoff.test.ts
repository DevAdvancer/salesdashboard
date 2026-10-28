import { planUserDeactivation, handoffDeactivatedUserLeads } from '@/lib/server/user-deactivation';
import { withLeadHistory } from '@/lib/server/lead-history';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { readableLeadHistory } from '@/lib/utils/lead-history-display';

const mockCreateAdmin = jest.fn();
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: (...args: unknown[]) => mockCreateAdmin(...args) }));
jest.mock('node-appwrite', () => ({
  ID: { unique: () => `event-${Math.random()}` },
  Permission: { read: (role: string) => `read("${role}")` }, Role: { user: (id: string) => `user:${id}` },
  Query: Object.fromEntries(['equal', 'or', 'limit', 'cursorAfter', 'select', 'orderAsc'].map(method =>
    [method, (...args: unknown[]) => JSON.stringify(method === 'equal' ? { method, attribute: args[0], values: [args[1]] } : { method, values: args })])),
}));

const actor = { $id: 'tl', name: 'Team Lead', role: 'team_lead', department: 'sales', isActive: true };
const source = { $id: 'source', name: 'Departing Agent', role: 'agent', teamLeadId: 'tl', department: 'sales', isActive: true };
const recipient = { $id: 'recipient', name: 'New Agent', role: 'agent', teamLeadId: 'tl', department: 'sales', isActive: true };

function fixture(count = 2) {
  let version = 0;
  const users = new Map([actor, source, recipient, { ...recipient, $id: 'creator', name: 'Original Creator' }].map(user => [user.$id, { ...user }]));
  const leads = new Map(Array.from({ length: count }, (_, index) => {
    const lead = { $id: `lead-${String(index).padStart(3, '0')}`, $updatedAt: 'before',
      ownerId: index % 2 ? 'creator' : source.$id, assignedToId: index % 2 ? source.$id : 'creator',
      status: index % 2 ? 'Won' : 'Interested', isClosed: Boolean(index % 2),
      closedAt: index % 2 ? '2026-10-01' : null,
      $permissions: ['read("user:source")'],
      data: JSON.stringify({ creatorId: 'creator', firstName: 'Client', payments: [{ amount: 100 }], field_16: `https://linkedin.com/in/person-${index}` }),
      history: JSON.stringify([{ id: 'created', actorId: 'creator', actorName: 'Original Creator', occurredAt: '2026-01-01', eventType: 'LEAD_CREATE', changes: {} }]) };
    return [lead.$id, lead] as const;
  }));
  const archive: Array<Record<string, any>> = [];
  const registry = new Map<string, any>();
  const raw = {
    clearReadCacheForCollection: jest.fn(),
    getDocument: jest.fn(async (_db, collection, id) => {
      const row = (collection === COLLECTIONS.USERS ? users : collection === COLLECTIONS.LEADS ? leads : registry).get(id);
      if (!row) throw { code: 404 }; return { ...row };
    }),
    listDocuments: jest.fn(async (_db, collection, queries) => {
      const rows = collection === COLLECTIONS.USERS ? [...users.values()] : collection === COLLECTIONS.LEADS ? [...leads.values()] : [];
      const parsed = queries.map((query: string) => JSON.parse(query));
      const cursor = parsed.find((query: any) => query.method === 'cursorAfter')?.values[0];
      const limit = parsed.find((query: any) => query.method === 'limit')?.values[0] || 100;
      const start = cursor ? rows.findIndex(row => row.$id === cursor) + 1 : 0;
      return { total: rows.length, documents: rows.slice(start, start + limit) };
    }),
    createDocument: jest.fn(async (_db, collection, id, data) => {
      if (collection === COLLECTIONS.LEAD_HISTORY) archive.push({ $id: id, ...data });
      else { if (registry.has(id)) throw { code: 409 }; registry.set(id, data); }
      return { $id: id, ...data };
    }),
    deleteDocument: jest.fn(async (_db, _collection, id) => { registry.delete(id); }),
    updateDocument: jest.fn(async (_db, collection, id, patch) => {
      if (collection !== COLLECTIONS.LEADS) { registry.set(id, patch); return patch; }
      const updated = { ...leads.get(id)!, ...patch, $updatedAt: `version-${++version}` };
      leads.set(id, updated); return updated;
    }),
  };
  mockCreateAdmin.mockImplementation(async options => ({ databases: withLeadHistory(raw as never,
    async () => ({ id: actor.$id, name: actor.name }), options?.deactivationHandoff) }));
  return { raw, users, leads, archive };
}

beforeEach(() => { process.env.CRM_LEAD_HISTORY_SNAPSHOT = 'true'; });
afterEach(() => { delete process.env.CRM_LEAD_HISTORY_SNAPSHOT; });

it('hands off every page of open and closed leads without losing creator, payments, status or creation history', async () => {
  const { raw, users, leads, archive } = fixture(105);
  const plan = await planUserDeactivation(raw as never, 'tl', 'source', 'recipient');
  expect(plan.leads).toHaveLength(105);
  users.get('source')!.isActive = false;
  expect(await handoffDeactivatedUserLeads(plan)).toBe(105);
  for (const lead of leads.values()) {
    expect(lead).toMatchObject({ ownerId: 'recipient', assignedToId: 'recipient' });
    expect(JSON.parse(lead.data)).toMatchObject({ creatorId: 'creator', creatorName: 'Original Creator', payments: [{ amount: 100 }] });
    expect(JSON.parse(lead.history)[0]).toMatchObject({ actorId: 'creator', eventType: 'LEAD_CREATE' });
    expect(lead.isClosed).toBe(lead.status === 'Won');
  }
  const completed = archive.filter(row => row.eventType === 'LEAD_HANDOFF');
  expect(completed).toHaveLength(105);
  expect(readableLeadHistory('LEAD_HANDOFF', JSON.parse(completed[0].payload).changes)).toMatchObject({
    title: 'Lead handed over after user inactivation', details: expect.arrayContaining(['Departing Agent → New Agent']),
  });
});

it('blocks ordinary takeover and scoped handoff while the source is still active', async () => {
  const { raw } = fixture();
  await expect(withLeadHistory(raw as never, async () => ({ id: 'tl', name: 'TL' }))
    .updateDocument(DATABASE_ID, COLLECTIONS.LEADS, 'lead-000', { ownerId: 'recipient' })).rejects.toThrow('ownership is protected');
  const plan = await planUserDeactivation(raw as never, 'tl', 'source', 'recipient');
  await expect(handoffDeactivatedUserLeads(plan)).rejects.toThrow('Handoff changed');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});

it('rejects a recipient that became inactive and detects changes since preview', async () => {
  const { raw, users, leads } = fixture();
  const before = await planUserDeactivation(raw as never, 'tl', 'source', 'recipient');
  leads.get('lead-000')!.$updatedAt = 'changed';
  expect((await planUserDeactivation(raw as never, 'tl', 'source', 'recipient')).hash).not.toBe(before.hash);
  users.get('source')!.isActive = false;
  users.get('recipient')!.isActive = false;
  await expect(handoffDeactivatedUserLeads(before)).rejects.toThrow('Handoff changed');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});

it('can retry remaining leads after a partial failure while preserving completed history', async () => {
  const { raw, users, leads, archive } = fixture();
  const plan = await planUserDeactivation(raw as never, 'tl', 'source', 'recipient');
  users.get('source')!.isActive = false;
  const original = raw.updateDocument.getMockImplementation()!;
  raw.updateDocument.mockImplementation(async (...args) => {
    if (args[2] === 'lead-001') throw new Error('temporarily offline');
    return original(...args);
  });
  await expect(handoffDeactivatedUserLeads(plan)).rejects.toThrow('temporarily offline');
  raw.updateDocument.mockImplementation(original);
  expect(await handoffDeactivatedUserLeads(plan)).toBe(1);
  expect([...leads.values()].every(lead => lead.ownerId === 'recipient' && lead.assignedToId === 'recipient')).toBe(true);
  expect(archive.filter(row => row.eventType === 'LEAD_HANDOFF')).toHaveLength(2);
  const failure = archive.find(row => row.eventType === 'LEAD_HANDOFF_FAILED')!;
  expect(readableLeadHistory(failure.eventType, JSON.parse(failure.payload).changes || {}).title).toBe('Change could not be completed');
});

it.each([true, false])('recovers creation evidence when available and labels unknown legacy attribution honestly: %s', async hasCreation => {
  const { raw, users, leads } = fixture(1);
  const lead = leads.get('lead-000')!;
  const data = JSON.parse(lead.data); delete data.creatorId;
  lead.data = JSON.stringify(data);
  if (!hasCreation) lead.history = '[]';
  const plan = await planUserDeactivation(raw as never, 'tl', 'source', 'recipient');
  users.get('source')!.isActive = false;
  await handoffDeactivatedUserLeads(plan);
  expect(JSON.parse(leads.get('lead-000')!.data)).toMatchObject(hasCreation
    ? { creatorId: 'creator', creatorName: 'Original Creator' }
    : { creatorId: 'source', creatorName: 'Departing Agent', creatorAttribution: 'original_owner' });
});
