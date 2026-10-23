import fc from 'fast-check';
import { getAttendanceFlagSummaryAction } from '@/app/actions/attendance/report';
const mockList = jest.fn();
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn(),
  getAuthenticatedUserDoc: async () => ({ $id: 'tl', role: 'team_lead', department: 'sales' }) }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: { listDocuments: mockList } }) }));
jest.mock('@/lib/server/notifications', () => ({}));
jest.mock('node-appwrite', () => ({ Query: Object.fromEntries(['equal', 'select', 'limit', 'cursorAfter'].map(method =>
  [method, (field: unknown, value: unknown) => JSON.stringify({ method, field, value })])) }));
it('keeps week/month counts correct with one filtered query, including weeks spanning months', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.record({
    dateKey: fc.constantFrom('2026-10-01', '2026-10-25', '2026-10-26', '2026-10-30', '2026-11-01', '2026-11-02'),
    present: fc.boolean(), presentWithDelegateFlag: fc.boolean(), userId: fc.constantFrom('tl', 'agent-one', 'agent-two'),
  }), { maxLength: 50 }), async rows => {
    mockList.mockClear().mockImplementation(async (_database, _collection, queries) => {
      const documents = rows.filter(row => queries.every((raw: string) => {
        const query = JSON.parse(raw);
        if (query.method !== 'equal' || query.field === 'teamLeadId') return true;
        return (Array.isArray(query.value) ? query.value : [query.value]).includes(row[query.field as keyof typeof row]);
      }));
      return { documents, total: documents.length };
    });
    const result = await getAttendanceFlagSummaryAction({ currentUserId: 'tl', referenceDateKey: '2026-10-30' });
    const flagged = rows.filter(row => row.userId !== 'tl' && row.present && row.presentWithDelegateFlag);
    expect(result.week.flaggedCount).toBe(flagged.filter(row => row.dateKey >= '2026-10-26' && row.dateKey <= '2026-11-01').length);
    expect(result.month.flaggedCount).toBe(flagged.filter(row => row.dateKey >= '2026-10-01' && row.dateKey <= '2026-10-31').length);
    expect(mockList).toHaveBeenCalledTimes(1);
  }), { numRuns: 40 });
});
