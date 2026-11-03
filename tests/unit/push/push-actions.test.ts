/** @jest-environment node */
const mockDb = { updateDocument: jest.fn(), createDocument: jest.fn(), getDocument: jest.fn(), deleteDocument: jest.fn() };
let mockImpersonating = false;
jest.mock('@/lib/server/crm-access', () => ({ securityDatabase: () => mockDb }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: async () => ({ $id: 'me', role: 'agent' }) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mockImpersonating ? { value: 'target' } : undefined) }) }));
jest.mock('web-push', () => ({ __esModule: true, default: {} }));
jest.mock('next/server', () => ({ after: jest.fn() }));
import { removePushSubscriptionAction, savePushSubscriptionAction } from '@/app/actions/push';
import { pushSubscriptionDocumentId } from '@/lib/server/web-push';

const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
// Deliberately synthetic base64url-compatible values; no real browser subscription.
const subscription = { endpoint, keys: { p256dh: 'test-public-key', auth: 'test-auth-key' } };
beforeEach(() => { jest.clearAllMocks(); mockImpersonating = false; });

it('creates one server-only record per browser, or moves it to the signed-in user', async () => {
  mockDb.updateDocument.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 404 }));
  await savePushSubscriptionAction(subscription);
  const id = pushSubscriptionDocumentId(endpoint);
  expect(id).toHaveLength(32);
  expect(mockDb.createDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), id,
    { userId: 'me', endpoint, p256dh: 'test-public-key', auth: 'test-auth-key' }, []);
  mockDb.updateDocument.mockResolvedValueOnce({});
  await savePushSubscriptionAction(subscription);
  expect(mockDb.updateDocument).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), id, expect.objectContaining({ userId: 'me' }));
});
it('rejects unknown push services, bad keys and impersonation', async () => {
  await expect(savePushSubscriptionAction({ ...subscription, endpoint: 'https://evil.example/x' })).rejects.toThrow('unsupported');
  await expect(savePushSubscriptionAction({ endpoint, keys: { p256dh: 'bad key', auth: 'x' } })).rejects.toThrow('unsupported');
  mockImpersonating = true;
  await expect(savePushSubscriptionAction(subscription)).rejects.toThrow('Stop impersonating');
  expect(mockDb.createDocument).not.toHaveBeenCalled(); expect(mockDb.updateDocument).not.toHaveBeenCalled();
});
it('removes only the signed-in user\'s own record', async () => {
  mockDb.getDocument.mockResolvedValueOnce({ userId: 'someone-else' });
  await removePushSubscriptionAction(endpoint);
  expect(mockDb.deleteDocument).not.toHaveBeenCalled();
  mockDb.getDocument.mockResolvedValueOnce({ userId: 'me' });
  await removePushSubscriptionAction(endpoint);
  expect(mockDb.deleteDocument).toHaveBeenCalledTimes(1);
});
