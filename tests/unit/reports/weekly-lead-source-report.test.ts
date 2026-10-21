import { buildWeeklyLeadSourceFacts, summarizeWeeklyLeadSources } from '@/lib/server/weekly-lead-source-report';
import type { Lead, NotInterestedLeadEvent } from '@/lib/types';
jest.mock('node-appwrite', () => ({ Query: {} }));

const range = { startDate: '2026-07-01', endDate: '2026-10-21' };
const lead = (id: string, extra: Partial<Lead> = {}) => ({
  $id: id, $createdAt: '2026-07-01T04:00:00Z', ownerId: 'creator', assignedToId: null,
  data: JSON.stringify({ sourceName: 'LinkedIN/Lead', creatorId: 'creator' }),
  status: 'Generated', isClosed: false, closedAt: null, ...extra,
}) as Lead;
const event = (id: string, extra = {}) => ({ $id: id, leadId: 'ni',
  previousOwnerId: 'creator', previousAssignedToId: 'assignee',
  markedAt: '2026-10-21T18:00:00Z', status: 'active', ...extra,
}) as NotInterestedLeadEvent;
const facts = (leads: Lead[], events: NotInterestedLeadEvent[] = []) =>
  buildWeeklyLeadSourceFacts({ ...range, leads, events });
const summary = (result: ReturnType<typeof facts>) => summarizeWeeklyLeadSources(result, new Set(['creator', 'assignee']));

test('Weekly Reports keeps not-interested LinkedIn leads in generated counts and credits the previous assignee for the outcome', () => {
  const result = facts([lead('ni', { ownerId: 'holding', status: 'Not Interested', isClosed: true,
    closedAt: '2026-10-21T18:00:00Z' }), lead('open')], [event('e')]);
  expect(summary(result).get('creator')).toEqual({ linkedinLeads: 2, linkedinNotInterested: 0, notInterested: 0 });
  expect(summary(result).get('assignee')).toEqual({ linkedinLeads: 0, linkedinNotInterested: 1, notInterested: 1 });
});

test('counts outcomes from leads created before July on their marking date', () => {
  const result = facts([lead('ni', { $createdAt: '2026-06-01T12:00:00Z' })], [event('e')]);
  expect(summary(result).get('assignee')).toMatchObject({ linkedinLeads: 0, linkedinNotInterested: 1 });
});

test('fills missing legacy events from closedAt once and ignores reopened events', () => {
  const legacy = lead('legacy', { status: 'Not Interested', isClosed: true,
    closedAt: '2026-07-15T12:00:00Z', data: JSON.stringify({ source: 'LinkedIn', creatorId: 'creator', closedById: 'assignee' }) });
  const result = facts([legacy, lead('ni', { status: 'Not Interested', closedAt: '2026-10-21T18:00:00Z' })],
    [event('old', { status: 'reopened' })]);
  expect(result.notInterested).toEqual([{ leadId: 'legacy', agentId: 'assignee', markedAt: legacy.closedAt }]);
  expect(summary(result).get('assignee')?.linkedinNotInterested).toBe(1);
});

test('does not classify referrals or website leads from a LinkedIn URL or imported request', () => {
  const result = facts([lead('referral', { data: JSON.stringify({ sourceName: 'Referral', linkedinRequestId: 'imported' }) }),
    lead('website', { data: JSON.stringify({ source: 'Website', linkedinProfileUrl: 'https://www.linkedin.com/in/example' }) }),
    lead('bad', { data: '{invalid' })]);
  expect(result.linkedin).toEqual([]);
});

test('uses Eastern dates at July and today boundaries and does not invent a missing outcome date', () => {
  const result = facts([
    lead('june', { $createdAt: '2026-07-01T03:59:59Z' }),
    lead('july'), lead('today', { $createdAt: '2026-10-22T03:59:59Z' }),
    lead('tomorrow', { $createdAt: '2026-10-22T04:00:00Z' }),
    lead('no-date', { status: 'Not Interested', $updatedAt: '2026-10-21T15:00:00Z' }),
  ]);
  expect(result.linkedin.filter(row => row.generated).map(row => row.leadId)).toEqual(['july', 'today', 'no-date']);
  expect(result.notInterested).toEqual([]);
});

test('deduplicates events and lead copies and keeps deleted-lead events in the overall Not Interested total', () => {
  const ni = lead('ni');
  const e = event('e', { previousAssignedToId: null });
  const result = facts([ni, ni], [e, e, event('deleted', { leadId: 'deleted', previousAssignedToId: null })]);
  const duplicated = { linkedin: [...result.linkedin, ...result.linkedin], notInterested: [...result.notInterested, ...result.notInterested] };
  expect(summary(duplicated).get('creator')).toEqual({ linkedinLeads: 1, linkedinNotInterested: 1, notInterested: 2 });
});

test('recovers synthetic historical events from the holding user using recorded closure attribution and date', () => {
  const result = buildWeeklyLeadSourceFacts({ ...range, unassignedOwnerId: 'holding',
    leads: [lead('ni', { ownerId: 'holding', status: 'Not Interested', closedAt: '2026-08-01T12:00:00Z',
      data: JSON.stringify({ source: 'LinkedIn', creatorId: 'creator', closedById: 'assignee' }) })],
    events: [event('synthetic', { previousOwnerId: 'holding', previousAssignedToId: null,
      markedById: 'holding', markedAt: '2026-11-01T12:00:00Z' })] });
  expect(result.notInterested).toEqual([{ leadId: 'ni', agentId: 'assignee', markedAt: '2026-08-01T12:00:00Z' }]);
  expect(summary(result).get('assignee')).toMatchObject({ notInterested: 1, linkedinNotInterested: 1 });
});
