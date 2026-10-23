/** @jest-environment node */
import { NextRequest } from 'next/server';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

const mockActor = jest.fn();
const mockList = jest.fn();
jest.mock('@/lib/server/crm-browser-data', () => ({ verifiedBrowserActor: () => mockActor() }));
jest.mock('@/lib/server/crm-access', () => ({ securityDatabase: () => ({ listDocuments: mockList }) }));
jest.mock('@/app/actions/lead/visibility', () => ({ getLeadVisibilityUserIds: async (_db: unknown, id: string) => [id] }));

describe('authorized change marker read budget', () => {
  let GET: typeof import('@/app/api/security/changes/route').GET;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const open = async (collection = COLLECTIONS.LEADS) => {
    const channel = `databases.${DATABASE_ID}.collections.${collection}.documents`;
    const response = await GET(new NextRequest(`http://localhost/api/security/changes?${new URLSearchParams({ channels: JSON.stringify([channel]) })}`));
    const reader = response.body!.getReader();
    readers.push(reader);
    await reader.read();
    return response;
  };

  beforeEach(async () => {
    jest.resetModules(); jest.useFakeTimers();
    mockActor.mockReset().mockResolvedValue({ $id: 'actor', role: 'admin', department: 'sales' });
    mockList.mockReset().mockResolvedValue({ total: 1, documents: [{ $id: 'latest', $updatedAt: 'today', $createdAt: 'today' }] });
    ({ GET } = await import('@/app/api/security/changes/route'));
  });
  afterEach(async () => {
    await Promise.all(readers.splice(0).map(reader => reader.cancel()));
    jest.useRealTimers();
  });

  it('shares identical markers across streams and skips lead reads between 30-second checks', async () => {
    await open(); await open();
    expect(mockList).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(mockList).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockList).toHaveBeenCalledTimes(2);
    // Access is verified once when each stream connects, not on every 10s tick.
    expect(mockActor).toHaveBeenCalledTimes(2);
  });

  it('verifies access again on the next connection and blocks a revoked user', async () => {
    await open();
    expect(mockActor).toHaveBeenCalledTimes(1);
    mockActor.mockRejectedValueOnce(new Error('revoked'));
    const channel = `databases.${DATABASE_ID}.collections.${COLLECTIONS.LEADS}.documents`;
    const response = await GET(new NextRequest(`http://localhost/api/security/changes?${new URLSearchParams({ channels: JSON.stringify([channel]) })}`));
    expect(response.status).toBe(403);
  });

  it('does not share markers across different lead visibility scopes', async () => {
    mockActor.mockResolvedValue({ $id: 'one', role: 'agent', department: 'sales' });
    await open();
    mockActor.mockResolvedValue({ $id: 'two', role: 'agent', department: 'sales' });
    await open();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('rechecks authorization before using a warm marker', async () => {
    await open();
    mockActor.mockRejectedValue(new Error('revoked'));
    const channel = `databases.${DATABASE_ID}.collections.${COLLECTIONS.LEADS}.documents`;
    const response = await GET(new NextRequest(`http://localhost/api/security/changes?${new URLSearchParams({ channels: JSON.stringify([channel]) })}`));
    expect(response.status).toBe(403);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('keeps chat payloads fresh at the existing ten-second cadence', async () => {
    await open(COLLECTIONS.CHAT_MESSAGES);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(mockList).toHaveBeenCalledTimes(3);
  });
});
