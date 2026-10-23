import fc from 'fast-check';
import { indexedProfileCandidates, LEAD_PROFILE_CHECKPOINT, LEAD_PROFILE_KEY, leadProfileIndexKey } from '@/lib/server/lead-profile-index';
import { profileIndexPlan } from '@/lib/server/lead-profile-index-maintenance';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';

jest.mock('node-appwrite', () => ({ Query: Object.fromEntries(['equal', 'greaterThanEqual', 'select', 'orderAsc', 'limit', 'cursorAfter', 'or'].map(method =>
  [method, (attribute: unknown, value: unknown) => JSON.stringify({ method, attribute, value })])) }));
const checkpoint = '2026-10-22T12:00:00.000Z';
function matches(row: any, raw: string): boolean {
  const query = JSON.parse(raw);
  if (query.method === 'or') return query.attribute.some((item: string) => matches(row, item));
  if (query.method === 'equal') return (Array.isArray(query.value) ? query.value : [query.value]).includes(row[query.attribute]);
  if (query.method === 'greaterThanEqual') return row[query.attribute] >= query.value;
  return true;
}
it('matches a complete scan for legacy fields, changed URLs, missing entries and stale index records', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ slug: fc.integer({ min: 0, max: 8 }), recent: fc.boolean(),
    field: fc.constantFrom('linkedinProfileUrl', 'linkedinProfile', 'field_16') }), { minLength: 10, maxLength: 100 }), async samples => {
    const leads = samples.map((sample, i) => ({ $id: `lead-${i}`, data: JSON.stringify({ [sample.field]: `https://linkedin.com/in/PERSON-${sample.slug}/?trk=legacy` }),
      status: 'Interested', $updatedAt: sample.recent ? '2026-10-23T10:00:00.000Z' : '2026-10-20T10:00:00.000Z' }));
    const entries = leads.map((lead, i) => ({ $id: `index-${i}`, kind: 'lead-index', leadId: lead.$id,
      [LEAD_PROFILE_KEY]: samples[i]!.recent ? 'obsolete-key' : leadProfileIndexKey(lead.data) }));
    const db = { getDocument: jest.fn(async () => ({ kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: checkpoint })),
      listDocuments: jest.fn(async (_db, collection, queries) => {
        const documents = (collection === COLLECTIONS.LEADS ? leads : entries).filter(row => queries.every((query: string) => matches(row, query)));
        return { total: documents.length, documents };
      }) } as unknown as Databases;
    const url = 'https://www.linkedin.com/in/person-1';
    const candidates = await indexedProfileCandidates(db, url);
    expect(candidates!.filter(lead => leadProfileUrl(lead.data) === url).map(lead => lead.$id).sort())
      .toEqual(leads.filter(lead => leadProfileUrl(lead.data) === url).map(lead => lead.$id).sort());
    const leadQuery = (db.listDocuments as jest.Mock).mock.calls.find(([, collection]) => collection === COLLECTIONS.LEADS)![2];
    expect(leadQuery.some((query: string) => query.includes('greaterThanEqual'))).toBe(true);
  }), { numRuns: 40 });
});

it('returns no historical leads for an unfamiliar profile when nothing changed since verification', async () => {
  const db = { getDocument: jest.fn(async () => ({ kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: checkpoint })),
    listDocuments: jest.fn(async () => ({ total: 0, documents: [] })) } as unknown as Databases;
  await expect(indexedProfileCandidates(db, 'https://linkedin.com/in/new-person')).resolves.toEqual([]);
  expect(db.listDocuments).toHaveBeenCalledTimes(2);
});

it('falls back without a ready checkpoint and never treats an index outage as an available profile', async () => {
  const db = { getDocument: jest.fn().mockRejectedValue({ code: 404 }), listDocuments: jest.fn() } as unknown as Databases;
  await expect(indexedProfileCandidates(db, 'https://linkedin.com/in/person')).resolves.toBeNull();
  (db.getDocument as jest.Mock).mockResolvedValue({ kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: checkpoint });
  (db.listDocuments as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(indexedProfileCandidates(db, 'https://linkedin.com/in/person')).rejects.toThrow('offline');
});

it('writes only separate metadata records and publishes coverage after full verification', async () => {
  const leads = [{ $id: 'lead', data: '{"field_16":"https://linkedin.com/in/person"}', $updatedAt: '2026-10-20T00:00:00.000Z' }];
  const stored = new Map<string, any>();
  const db = {
    listDocuments: jest.fn(async (_database, collection) => ({ documents: collection === COLLECTIONS.LEADS ? leads : [...stored.values()].filter(row => row.kind === 'lead-index') })),
    createDocument: jest.fn(async (_database, collection, id, data) => {
      expect(collection).toBe(COLLECTIONS.LINKEDIN_LEAD_REGISTRY);
      if (stored.has(id)) throw { code: 409 };
      const row = { $id: id, $createdAt: new Date().toISOString(), ...data }; stored.set(id, row); return row;
    }), updateDocument: jest.fn(), deleteDocument: jest.fn(async (_database, collection, id) => { expect(collection).toBe(COLLECTIONS.LINKEDIN_LEAD_REGISTRY); stored.delete(id); }),
  } as unknown as Databases;
  const plan = await profileIndexPlan(db);
  expect(db.createDocument).not.toHaveBeenCalled();
  await plan.apply();
  expect(stored.get(LEAD_PROFILE_CHECKPOINT)).toMatchObject({ leadId: 'ready' });
  expect(leads[0]).not.toHaveProperty(LEAD_PROFILE_KEY);
  expect(db.updateDocument).not.toHaveBeenCalled();
  expect(stored.has('profile-index-refresh')).toBe(false);
});

it('refreshes only changes since the checkpoint instead of rescanning historical leads', async () => {
  const leads = [{ $id: 'historical', data: '{}', $updatedAt: '2020-01-01T00:00:00Z' },
    { $id: 'recent', data: '{"field_16":"https://linkedin.com/in/recent"}', $updatedAt: '2026-10-23T00:00:00Z' }];
  const marker = { $id: LEAD_PROFILE_CHECKPOINT, kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: checkpoint };
  const stored = new Map<string, any>([[LEAD_PROFILE_CHECKPOINT, marker]]);
  const db = {
    getDocument: jest.fn(async () => marker),
    listDocuments: jest.fn(async (_database, collection, queries) => {
      const source = collection === COLLECTIONS.LEADS ? leads : [...stored.values()];
      const documents = source.filter(row => queries.every((query: string) => matches(row, query)));
      return { documents, total: documents.length };
    }),
    createDocument: jest.fn(async (_database, collection, id, data) => {
      expect(collection).toBe(COLLECTIONS.LINKEDIN_LEAD_REGISTRY);
      if (stored.has(id)) throw { code: 409 };
      const row = { $id: id, $createdAt: new Date().toISOString(), ...data }; stored.set(id, row); return row;
    }),
    updateDocument: jest.fn(async (_database, collection, id, data) => { expect(collection).toBe(COLLECTIONS.LINKEDIN_LEAD_REGISTRY); stored.set(id, { $id: id, ...data }); }),
    deleteDocument: jest.fn(async (_database, _collection, id) => { stored.delete(id); }),
  } as unknown as Databases;
  const plan = await profileIndexPlan(db);
  expect(plan.scanned).toBe(1);
  await plan.apply();
  for (const [, collection, queries] of (db.listDocuments as jest.Mock).mock.calls) {
    if (collection === COLLECTIONS.LEADS) expect(queries.some((query: string) => query.includes('greaterThanEqual'))).toBe(true);
  }
  expect(stored.get(LEAD_PROFILE_CHECKPOINT).leadId).toBe('ready');
});
