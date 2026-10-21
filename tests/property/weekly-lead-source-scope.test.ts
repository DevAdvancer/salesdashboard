import fc from 'fast-check';
import { buildWeeklyLeadSourceFacts, summarizeWeeklyLeadSources } from '@/lib/server/weekly-lead-source-report';
import type { Lead, NotInterestedLeadEvent } from '@/lib/types';
jest.mock('node-appwrite', () => ({ Query: {} }));

test('weekly source totals stay within the existing visible users and preserve generation once after not-interested', () => {
  fc.assert(fc.property(fc.array(fc.record({
    visibleCreator: fc.boolean(), visibleAssignee: fc.boolean(), interested: fc.boolean(),
  }), { minLength: 1, maxLength: 40 }), rows => {
    const leads = rows.map((row, i) => ({ $id: `lead-${i}`, ownerId: 'holding',
      status: row.interested ? 'Generated' : 'Not Interested', $createdAt: '2026-07-15T12:00:00Z',
      data: JSON.stringify({ sourceName: 'LinkedIN/Lead', creatorId: `creator-${i}` }),
    })) as Lead[];
    const events = rows.flatMap((row, i) => row.interested ? [] : [{
      $id: `e-${i}`, leadId: `lead-${i}`, previousOwnerId: `owner-${i}`,
      markedAt: '2026-10-21T15:00:00Z', status: 'active',
    }]) as NotInterestedLeadEvent[];
    const visible = new Set(rows.flatMap((row, i) => [
      ...(row.visibleCreator ? [`creator-${i}`] : []), ...(row.visibleAssignee ? [`owner-${i}`] : []),
    ]));
    const facts = buildWeeklyLeadSourceFacts({ leads, events, startDate: '2026-07-01', endDate: '2026-10-21' });
    const summary = summarizeWeeklyLeadSources({ linkedin: [...facts.linkedin, ...facts.linkedin],
      notInterested: [...facts.notInterested, ...facts.notInterested] }, visible);
    expect([...summary.keys()].every(id => visible.has(id))).toBe(true);
    expect([...summary.values()].reduce((sum, row) => sum + row.linkedinLeads, 0)).toBe(rows.filter(row => row.visibleCreator).length);
    expect([...summary.values()].reduce((sum, row) => sum + row.linkedinNotInterested, 0)).toBe(
      rows.filter(row => !row.interested && row.visibleAssignee).length);
  }));
});
