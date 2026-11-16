/** @jest-environment node */
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import { GET } from '@/app/api/cron/linkedin-weekly-followup/route';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { sendNotificationEmail } from '@/lib/server/email-service';
import type { LinkedinRequest } from '@/lib/types';
import config from '@/vercel.json';

jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: jest.fn() }));
jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: jest.fn() }));
jest.mock('@/lib/utils/logger', () => ({ logger: { error: jest.fn() } }));

const admin = jest.mocked(createAdminClient);
const list = jest.mocked(listAllDocuments);
const send = jest.mocked(sendNotificationEmail);
const route = '/api/cron/linkedin-weekly-followup';
const originalSecret = process.env.CRON_SECRET;
const claims = new Set<string>();
const databases = {
  clearReadCacheForCollection: jest.fn(),
  createDocument: jest.fn(async (_database, _collection, id: string) => {
    if (claims.has(id)) throw { code: 409 };
    claims.add(id);
  }),
  deleteDocument: jest.fn(async (_database, _collection, id: string) => { claims.delete(id); }),
};

const users = [
  { $id: 'agent', name: 'Agent', email: 'agent@example.com', role: 'agent', department: 'sales', isActive: true },
  { $id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin', department: 'sales', isActive: true },
  { $id: 'tl', name: 'Team Lead', email: 'tl@example.com', role: 'team_lead', department: 'sales', isActive: true },
  { $id: 'inactive', name: 'Inactive', email: 'inactive@example.com', role: 'agent', department: 'sales', isActive: false },
  { $id: 'resume', name: 'Resume', email: 'resume@example.com', role: 'team_lead', department: 'resume', isActive: true },
  { $id: 'no-grant', name: 'No grant', email: 'no-grant@example.com', role: 'agent', department: 'sales', isActive: true },
  { $id: 'no-requests', name: 'No requests', email: 'empty@example.com', role: 'agent', department: 'sales', isActive: true },
];

function invite(owner: string, suffix = 'current'): LinkedinRequest {
  return { $id: `request-${owner}`, agentId: owner, teamLeadId: 'tl', accountId: 'sudo', company: `Company ${owner}`,
    targetUrl: `https://www.linkedin.com/in/${owner}`, dateSent: '2026-11-09T00:00:00.000Z', acceptedAt: null,
    conversationId: `${owner}-${suffix}`, status: 'sent' };
}
const archived = { ...invite('agent', 'archive'), status: 'withdrawn' };

function request(authorized = true) {
  return new Request(`https://crm.example.com${route}`, {
    headers: authorized ? { authorization: 'Bearer local-weekly-secret' } : {},
  });
}

function setFixtures(invitations: LinkedinRequest[]) {
  list.mockImplementation(async ({ collectionId, queries }) => {
    const filters = queries.map(query => JSON.parse(query));
    if (collectionId === COLLECTIONS.BETA_FEATURE_ACCESS) {
      return users.map(user => ({ userId: user.$id, enabled: user.$id !== 'no-grant' }));
    }
    if (collectionId === COLLECTIONS.USERS) return users;
    if (collectionId === COLLECTIONS.LINKEDIN_REQUESTS) return invitations;
    if (collectionId === COLLECTIONS.LINKEDIN_ACCOUNTS) return filters.some(query => query.values?.includes('sudo'))
      ? [{ $id: 'sudo', idName: 'Sudo profile', accountType: 'sudo', mainAccountId: 'main' }]
      : [{ $id: 'main', idName: 'Main profile', accountType: 'main' }];
    if (filters.some(query => query.attribute === 'kind' && query.values?.includes('archive'))) {
      return [{ payload: JSON.stringify(archived) }];
    }
    return [
      { conversationId: 'agent-archive', kind: 'invitation', payload: 'Invitation' },
      { conversationId: 'agent-archive', kind: 'message',
        payload: JSON.stringify({ direction: 'transcript', date: '2026-11-10', text: 'Agent: Hello\n\nClient: Hi' }) },
    ];
  });
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T14:00:00Z'));
  jest.clearAllMocks();
  claims.clear();
  process.env.CRON_SECRET = 'local-weekly-secret';
  admin.mockResolvedValue({ databases } as never);
  send.mockResolvedValue({ messageId: 'local-test' } as never);
  setFixtures(users.filter(user => user.$id !== 'no-requests').map(user => invite(user.$id)));
});

afterEach(() => {
  jest.useRealTimers();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

it('requires the cron secret and schedules both possible UTC hours on Friday', async () => {
  expect(config.crons.find(cron => cron.path === route)?.schedule).toBe('0 13,14 * * 5');
  expect((await GET(request(false))).status).toBe(401);
  expect(admin).not.toHaveBeenCalled();
});

it.each([['2026-10-30', 13, '2026-10-26'], ['2026-11-06', 14, '2026-11-02']])(
  'runs at 9 AM Eastern across daylight saving on %s', async (date, activeHour, monday) => {
    for (const hour of [13, 14]) {
      jest.setSystemTime(new Date(`${date}T${hour}:00:00Z`));
      const result = await (await GET(request())).json();
      expect(result).toEqual(hour === activeHour
        ? { ok: true, sent: 3, duplicate: 0, failed: 0 }
        : { ok: true, skipped: true });
    }
    expect(admin).toHaveBeenCalledTimes(1);
    const scan = list.mock.calls.find(([options]) => options.collectionId === COLLECTIONS.LINKEDIN_REQUESTS)![0];
    expect(scan.queries.map(query => JSON.parse(query))).toContainEqual(
      { method: 'greaterThanEqual', attribute: 'dateSent', values: [`${monday}T00:00:00.000Z`] },
    );
  },
);

it('keeps each workbook scoped to its sender regardless of result order or role', async () => {
  const current = users.filter(user => user.$id !== 'no-requests').map(user => invite(user.$id));
  await fc.assert(fc.asyncProperty(fc.shuffledSubarray(current, { minLength: current.length, maxLength: current.length }), async shuffled => {
    claims.clear();
    send.mockClear();
    setFixtures(shuffled);
    expect(await (await GET(request())).json()).toEqual({ ok: true, sent: 3, duplicate: 0, failed: 0 });
    expect(send.mock.calls.map(([email]) => email.to).sort()).toEqual(['admin@example.com', 'agent@example.com', 'tl@example.com']);
    for (const [{ to, attachments }] of send.mock.calls) {
      const book = XLSX.read(attachments![0].content);
      expect(book.SheetNames).toHaveLength(1);
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[book.SheetNames[0]]);
      const owner = to.split('@')[0];
      expect(rows.map(row => row['CRM sender ID'])).toEqual(owner === 'agent' ? ['agent', 'agent'] : [owner]);
      if (owner === 'agent') expect(rows).toContainEqual(expect.objectContaining({
        'Conversation ID': 'agent-archive', Status: 'withdrawn', 'Main LinkedIn ID': 'main', 'Sudo LinkedIn ID': 'sudo',
        'Initial invitation text': 'Invitation', Conversation: '2026-11-10 ET · Pasted conversation\nAgent: Hello\n\nClient: Hi',
      }));
    }
  }), { numRuns: 8 });
});

it('sends once per sender when invocations overlap, and retries only failed recipients', async () => {
  send.mockImplementation(async ({ to }) => to === 'tl@example.com' ? null : { messageId: 'local-test' } as never);
  const failed = await GET(request());
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ ok: false, sent: 2, duplicate: 0, failed: 1 });
  expect(databases.deleteDocument).toHaveBeenCalledTimes(1);
  send.mockClear().mockResolvedValue({ messageId: 'local-retry' } as never);
  const retried = await Promise.all([GET(request()), GET(request())]);
  expect(retried.every(response => response.ok)).toBe(true);
  expect(send.mock.calls.map(([email]) => email.to)).toEqual(['tl@example.com']);
});
