/** @jest-environment node */
import { resolveProgressVisibleIds } from '@/lib/server/client-progress-scope';
import type { Databases } from 'node-appwrite';

test('hierarchy queries target direct reports, follow array parents, and do not scan the user collection', async () => {
  const queries: any[][] = [];
  const db = { getCollection: jest.fn().mockResolvedValue({ attributes: [{ key: 'teamLeadId' }, { key: 'managerIds' }] }),
    listDocuments: jest.fn(async (_d, _c, raw: string[]) => {
      const parsed = raw.map(query => JSON.parse(query)); queries.push(parsed);
      expect(parsed.some(query => query.method === 'or')).toBe(true);
      const parents = parsed.find(query => query.method === 'or').values.flatMap((query: any) => query.values);
      if (parents.includes('root')) return { documents: [{ $id: 'tl', role: 'team_lead', department: 'sales', managerIds: ['root'] }, { $id: 'foreign', role: 'agent', department: 'resume', teamLeadId: 'root' }], total: 2 };
      return { documents: [{ $id: 'agent', role: 'agent', department: 'sales', teamLeadId: 'tl' }], total: 1 };
    }) };
  await expect(resolveProgressVisibleIds(db as unknown as Databases, { $id: 'root', role: 'senior_tl', department: 'sales' })).resolves.toEqual(['root', 'tl', 'agent']);
  expect(db.listDocuments).toHaveBeenCalledTimes(2);
  expect(queries.every(page => page.some(query => query.method === 'select' && query.values.includes('$id')))).toBe(true);
});

test('agents and leadership need no hierarchy reads', async () => {
  const db = { getCollection: jest.fn(), listDocuments: jest.fn() };
  for (const role of ['agent', 'admin', 'developer', 'operations', 'monitor', 'lead_generation', 'compliance'] as const) {
    await expect(resolveProgressVisibleIds(db as unknown as Databases, { $id: 'user', role })).resolves.toEqual(['user']);
  }
  expect(db.getCollection).not.toHaveBeenCalled(); expect(db.listDocuments).not.toHaveBeenCalled();
});
