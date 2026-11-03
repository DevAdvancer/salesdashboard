/** @jest-environment node */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: (...args: unknown[]) => mockSend(...args) } }));
jest.mock('next/server', () => ({ after: () => { throw new Error('outside request'); } }));
import { sendPushToUser } from '@/lib/server/web-push';

const db = { listDocuments: jest.fn(), deleteDocument: jest.fn() };
const payload = { title: 'Lead assigned', body: 'x'.repeat(500), url: '/leads/1', tag: 'n1' };
const row = (id: string, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) => ({ $id: id, userId: 'u1', endpoint, p256dh: 'key', auth: 'auth' });
const env = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'https://crm.example' });
  db.deleteDocument.mockResolvedValue({});
});
afterAll(() => { process.env = env; });

it('sends a short payload to each allowed browser and removes expired ones', async () => {
  db.listDocuments.mockResolvedValue({ documents: [row('a'), row('b'), row('c', 'https://evil.example/x')] });
  mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
  await expect(sendPushToUser('u1', payload, db as never)).resolves.toEqual({ sent: 1 });
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mockSend.mock.calls[0][1]).body).toHaveLength(300);
  expect(db.deleteDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'b');
});
it('keeps a subscription after a temporary push-service error', async () => {
  db.listDocuments.mockResolvedValue({ documents: [row('a')] });
  mockSend.mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 503 }));
  await expect(sendPushToUser('u1', payload, db as never)).resolves.toEqual({ sent: 0 });
  expect(db.deleteDocument).not.toHaveBeenCalled();
});
it('does nothing without VAPID keys, and never throws when the collection is missing', async () => {
  delete process.env.VAPID_PRIVATE_KEY;
  await expect(sendPushToUser('u1', payload, db as never)).resolves.toEqual({ sent: 0 });
  expect(db.listDocuments).not.toHaveBeenCalled();
  process.env.VAPID_PRIVATE_KEY = 'priv';
  db.listDocuments.mockRejectedValue(Object.assign(new Error('missing'), { code: 404 }));
  await expect(sendPushToUser('u1', payload, db as never)).resolves.toEqual({ sent: 0 });
});
