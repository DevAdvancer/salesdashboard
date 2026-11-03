import { createNotificationRecord } from '@/lib/server/notifications';
import { createAdminClient } from '@/lib/server/appwrite';
import { queuePushToUser } from '@/lib/server/web-push';

jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/web-push', () => ({ queuePushToUser: jest.fn() }));
jest.mock('node-appwrite', () => ({ ID: { unique: () => 'notification-id' }, Query: { equal: () => 'equal', select: () => 'select', limit: () => 'limit' } }));

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: {}, users: { get: jest.fn().mockResolvedValue({ email: 'agent@example.com' }) } });
});

it('queues a pop-up with an in-app link and the notification ID as its tag', async () => {
  const databases = { createDocument: jest.fn().mockResolvedValue({ $id: 'notification-id' }) };
  await createNotificationRecord(databases as never, { recipientId: 'agent', type: 'LEAD_ASSIGNED', title: 'Lead assigned',
    body: 'Open the lead.', targetId: 'lead-id', targetType: 'lead' }, { isActive: true, notificationsEnabled: true });
  expect(queuePushToUser).toHaveBeenCalledWith('agent', { title: 'Lead assigned', body: 'Open the lead.', tag: 'notification-id', url: '/leads/lead-id' });
});
it('falls back to the notifications page and never pushes to inactive users', async () => {
  const databases = { createDocument: jest.fn().mockResolvedValue({ $id: 'n2' }) };
  await createNotificationRecord(databases as never, { recipientId: 'agent', type: 'SYSTEM', title: 'Hi', body: 'b' }, { isActive: true });
  expect(queuePushToUser).toHaveBeenCalledWith('agent', expect.objectContaining({ url: '/notifications' }));
  (queuePushToUser as jest.Mock).mockClear();
  await createNotificationRecord(databases as never, { recipientId: 'gone', type: 'SYSTEM', title: 'Hi', body: 'b' }, { isActive: false });
  expect(queuePushToUser).not.toHaveBeenCalled();
});
