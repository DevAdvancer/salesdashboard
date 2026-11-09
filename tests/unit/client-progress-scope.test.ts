/** @jest-environment node */
import { resolveProgressVisibleIds } from '@/lib/server/client-progress-scope';
import type { Databases } from 'node-appwrite';
import fc from 'fast-check';

test('Sales team leads see their reports when only the legacy teamLeadId field exists', async () => {
  await jest.isolateModulesAsync(async () => {
    const { resolveProgressVisibleIds } = await import('@/lib/server/client-progress-scope');

    await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 12 }), async ([leadId, ...reportIds]) => {
      const users = reportIds.map(($id, index) => ({
        $id,
        role: 'agent',
        teamLeadId: leadId,
        department: index % 2 ? 'resume' : undefined,
      }));
      const db = {
        getCollection: jest.fn().mockResolvedValue({ attributes: [{ key: 'teamLeadId' }] }),
        listDocuments: jest.fn(async (_d, _c, raw: string[]) => {
          const queries = raw.map(query => JSON.parse(query));
          expect(queries).toContainEqual({ method: 'equal', attribute: 'teamLeadId', values: [leadId] });
          expect(queries.some(query => query.method === 'or')).toBe(false);
          return { documents: users, total: users.length };
        }),
      };

      await expect(resolveProgressVisibleIds(db as unknown as Databases, { $id: leadId, role: 'team_lead', department: 'sales' }))
        .resolves.toEqual([leadId, ...users.filter(user => !user.department).map(user => user.$id)]);
    }));
  });
});

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
