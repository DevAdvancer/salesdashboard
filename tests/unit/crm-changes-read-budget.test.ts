/** @jest-environment node */
import { NextRequest } from 'next/server';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

const mockActor = jest.fn();
const mockList = jest.fn();
jest.mock('@/lib/server/crm-browser-data', () => ({ verifiedBrowserActor: () => mockActor() }));
jest.mock('@/lib/server/crm-access', () => ({
  CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  securityDatabase: () => ({ listDocuments: mockList }),
}));
jest.mock('@/app/actions/lead/visibility', () => ({ getLeadVisibilityUserIds: async (_db: unknown, id: string) => [id] }));

describe('authorized change snapshot budget', () => {
  let GET: typeof import('@/app/api/security/changes/route').GET;
  const channel = (collection: string) => `databases.${DATABASE_ID}.collections.${collection}.documents`;
  const read = (collections: string[] = [COLLECTIONS.LEADS], mode = 'poll') => GET(new NextRequest(
    `http://localhost/api/security/changes?${new URLSearchParams({ channels: JSON.stringify(collections.map(channel)), mode })}`));

  beforeEach(async () => {
    jest.resetModules(); jest.useFakeTimers();
    mockActor.mockReset().mockResolvedValue({ $id: 'actor', role: 'admin', department: 'sales' });
    mockList.mockReset().mockResolvedValue({ total: 1, documents: [{ $id: 'latest', $updatedAt: 'today', $createdAt: 'today' }] });
    ({ GET } = await import('@/app/api/security/changes/route'));
  });
  afterEach(() => jest.useRealTimers());

  it('finishes a JSON snapshot with no timers or reads left running', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ changes: [expect.objectContaining({ channels: [channel(COLLECTIONS.LEADS)], payload: {} })] });
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('shares only markers for 60 seconds and authorizes every request', async () => {
    await read(); await read();
    expect(mockList).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    await read();
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockActor).toHaveBeenCalledTimes(3);
  });

  it('blocks a revoked user before reading a warm marker', async () => {
    await read();
    const { CrmAccessError } = await import('@/lib/server/crm-access');
    mockActor.mockRejectedValueOnce(new CrmAccessError(403, 'revoked'));
    const response = await read();
    expect(response.status).toBe(403);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('does not share markers across lead visibility scopes', async () => {
    mockActor.mockResolvedValue({ $id: 'one', role: 'agent', department: 'sales' });
    await read();
    mockActor.mockResolvedValue({ $id: 'two', role: 'agent', department: 'sales' });
    await read();
    expect(mockList).toHaveBeenCalledTimes(2);
    const queries = mockList.mock.calls.map(call => JSON.stringify(call[2]));
    expect(queries[0]).toContain('one');
    expect(queries[1]).toContain('two');
  });

  it('never caches chat or notification bodies and scopes recipients', async () => {
    await read([COLLECTIONS.NOTIFICATIONS, COLLECTIONS.CHAT_MESSAGES]);
    await read([COLLECTIONS.NOTIFICATIONS, COLLECTIONS.CHAT_MESSAGES]);
    expect(mockList).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(mockList.mock.calls[0][2])).toContain('recipientId');
    expect(JSON.stringify(mockList.mock.calls[0][2])).toContain('actor');
  });

  it.each(['sales', 'resume'])('keeps %s non-leadership within department chat and lead scopes', async department => {
    mockActor.mockResolvedValue({ $id: 'agent', role: 'agent', department });
    const response = await read([COLLECTIONS.CHAT_MESSAGES, COLLECTIONS.RESUME_CHAT_MESSAGES, COLLECTIONS.LEADS]);
    const body = await response.json();
    const channels = body.changes.flatMap((change: { channels: string[] }) => change.channels);
    expect(channels).toContain(channel(department === 'sales' ? COLLECTIONS.CHAT_MESSAGES : COLLECTIONS.RESUME_CHAT_MESSAGES));
    expect(channels).not.toContain(channel(department === 'sales' ? COLLECTIONS.RESUME_CHAT_MESSAGES : COLLECTIONS.CHAT_MESSAGES));
    expect(channels.includes(channel(COLLECTIONS.LEADS))).toBe(department === 'sales');
  });

  it('rejects secret and malformed subscriptions without reading markers', async () => {
    for (const collection of [COLLECTIONS.SECURITY_CHALLENGES, COLLECTIONS.CRM_ACCESS_REQUESTS, COLLECTIONS.LEAD_HISTORY, 'unknown']) {
      expect((await read([collection])).status).toBe(400);
    }
    expect((await GET(new NextRequest('http://localhost/api/security/changes?channels=not-json'))).status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('deduplicates channels and keeps old EventSource tabs finite with a 60s retry', async () => {
    const response = await read([COLLECTIONS.NOTIFICATIONS, COLLECTIONS.NOTIFICATIONS], '');
    const text = await response.text();
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toMatch(/^retry: 60000\n\n/);
    expect(text.match(/event: message/g)).toHaveLength(1);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports transient database failures as retryable without pretending access was revoked', async () => {
    mockList.mockRejectedValueOnce(new Error('unavailable'));
    expect((await read()).status).toBe(503);
    expect((await read()).status).toBe(200);
  });
});
