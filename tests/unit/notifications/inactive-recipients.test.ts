import { excludeInactiveGraphRecipients, excludeInactiveUserEmails } from '@/lib/server/active-email-recipients';
import { createNotificationRecord } from '@/lib/server/notifications';

jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('node-appwrite', () => ({
  ID: { unique: () => 'notification-id' },
  Query: {
    equal: () => 'equal',
    select: () => 'select',
    limit: () => 'limit',
    cursorAfter: () => 'cursor',
  },
}));

describe('inactive notification recipients', () => {
  it('does not create a notification for an inactive user', async () => {
    const databases = {
      getDocument: jest.fn().mockResolvedValue({ isActive: false }),
      createDocument: jest.fn(),
    };

    await expect(createNotificationRecord(databases as never, {
      recipientId: 'inactive-user', type: 'TEST', title: 'Test', body: 'Test',
    })).resolves.toBeNull();
    expect(databases.createDocument).not.toHaveBeenCalled();
  });

  it('excludes inactive CRM accounts from scheduled email recipients', async () => {
    const databases = {
      listDocuments: jest.fn().mockResolvedValue({ documents: [
        { $id: 'one', email: 'inactive@example.com', isActive: false },
        { $id: 'two', email: 'active@example.com', isActive: true },
      ] }),
    };

    await expect(excludeInactiveUserEmails(databases as never, [
      'inactive@example.com', 'active@example.com', 'external@example.com',
    ])).resolves.toEqual(['active@example.com', 'external@example.com']);
  });

  it('removes inactive users from every Graph recipient field', async () => {
    const databases = {
      listDocuments: jest.fn().mockResolvedValue({ documents: [
        { $id: 'one', email: 'inactive@example.com', isActive: false },
      ] }),
    };
    const recipient = (address: string) => ({ emailAddress: { address } });
    const result = await excludeInactiveGraphRecipients(databases as never, {
      toRecipients: [recipient('active@example.com'), recipient('inactive@example.com')],
      ccRecipients: [recipient('inactive@example.com')],
      bccRecipients: [recipient('inactive@example.com')],
    });

    expect(result.toRecipients).toEqual([recipient('active@example.com')]);
    expect(result.ccRecipients).toEqual([]);
    expect(result.bccRecipients).toEqual([]);
  });
});
