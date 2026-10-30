import fc from 'fast-check';
import { getPrimaryBranchId, normalizeUserBranches } from '@/lib/utils/user-branches';
import { buildTargetReport, targetReportBranchEntries } from '@/lib/utils/monthly-target-report';
import type { User, MonthlyTarget } from '@/lib/types';

test('persists all memberships and counts each contribution exactly once under the selected primary', () => {
  fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 2, maxLength: 8 }),
    fc.nat(), fc.integer({ min: 1, max: 100000 }), (numbers, selected, amount) => {
      const ids = numbers.map(String), primary = ids[selected % ids.length];
      const membership = normalizeUserBranches(ids, primary);
      expect(new Set(membership.branchIds)).toEqual(new Set(ids));
      expect(membership.branchIds[0]).toBe(primary);
      const user = { $id: 'tl', name: 'TL', role: 'team_lead', ...membership } as User;
      expect(getPrimaryBranchId(user)).toBe(primary);
      const result = buildTargetReport({ monthKey: '2026-10', targets: [{ $id: 'target', teamLeadId: 'tl', totalAmount: amount }] as MonthlyTarget[],
        assignmentsByTargetId: {}, usersByAgentId: new Map([['tl', user]]),
        agentStatsByUserId: { tl: { achieved: amount, leadCount: 1, referralExcludedCount: 0, notInterestedCount: 0 } },
        branchMap: new Map(ids.map(id => [id, id])),
      });
      const entries = targetReportBranchEntries(result.rows[0].agents);
      expect(entries).toHaveLength(1);
      expect(entries.filter(entry => entry.primary).map(entry => entry.branchId)).toEqual([primary]);
      expect(result.totals.achieved).toBe(amount);
      expect(result.totals.target).toBe(amount);
    }));
});

test('unassigned contribution rows preserve readable revenue while only Admin and Monitor get automatic targets', () => {
  fc.assert(fc.property(fc.array(fc.record({ role: fc.constantFrom('admin', 'monitor', 'agent'),
    visible: fc.boolean(), amount: fc.integer({ min: 0, max: 100000 }) }), { maxLength: 30 }), records => {
      const users = records.map((record, i) => ({ $id: String(i), name: String(i), role: record.role, branchIds: [] })) as User[];
      const result = buildTargetReport({ monthKey: '2026-10', targets: [], assignmentsByTargetId: {},
        usersByAgentId: new Map(users.filter((_, i) => records[i].visible).map(user => [user.$id, user])),
        agentStatsByUserId: Object.fromEntries(records.map((record, i) => [String(i), {
          achieved: record.amount, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0,
        }])),
      });
      const expected = records.reduce((sum, record) => sum +
        (record.visible && record.role !== 'agent' ? record.amount : 0), 0);
      expect(result.totals.target).toBe(expected);
      expect(result.totals.achieved).toBe(records.reduce((sum, record) => sum + (record.visible ? record.amount : 0), 0));
      expect(result.rows.every(row => records[Number(row.teamLeadId)].visible)).toBe(true);
    }));
});
