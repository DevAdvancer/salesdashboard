import { summarizeLinkedinRequests } from '@/lib/utils/linkedin-report-summary';
import type { LinkedinAccount, LinkedinRequest } from '@/lib/types';

const account = { $id: 'account-1', company: 'Vizva INC', idName: 'Main' } as LinkedinAccount;
const request = (id: string, status: string, extra = {}) => ({
  $id: id, $createdAt: '2026-10-14T15:00:00.000Z', agentId: 'agent-1',
  accountId: 'account-1', company: 'Vizva INC', status, ...extra,
}) as LinkedinRequest;

test('each created request contributes once to its row and exactly one status column', () => {
  const requests = [request('1', 'sent'), request('2', 'accepted', { leadId: 'lead-1' }),
    request('3', 'withdrawn'), request('4', 'sent', { coldCall: true })];
  const rows = summarizeLinkedinRequests(requests, new Map([[account.$id, account]]), [
    { leadId: 'lead-1', request: requests[1], generated: true, closure: true },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sent: 4, accepted: 1, withdrawn: 1,
    notAccepted: 2, coldCalls: 1, leadsGenerated: 1, closures: 1 });
  expect(rows[0].sent).toBe(rows[0].accepted + rows[0].withdrawn + rows[0].notAccepted);
});

test('counts leads and closures from older requests without adding a sent request in the period', () => {
  const older = request('older', 'accepted');
  const rows = summarizeLinkedinRequests([], new Map([[account.$id, account]]), [
    { leadId: 'lead-a', request: older, generated: true, closure: false },
    { leadId: 'lead-b', request: older, generated: false, closure: true },
    { leadId: 'lead-a', request: older, generated: true, closure: false },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sent: 0, accepted: 0, leadsGenerated: 1, closures: 1 });
});
