jest.mock('node-appwrite', () => ({ Query: { equal: jest.fn(), select: jest.fn() } }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));

import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { betaAccessDocumentId, hasLinkedinHelperAccess } from '@/lib/server/beta-feature-access';
import { setLinkedinHelperBetaAccessAction } from '@/app/actions/beta';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { getNotificationUrl } from '@/lib/utils/notification-link';

const databases = { clearReadCacheForCollection: jest.fn(), getDocument: jest.fn(), updateDocument: jest.fn(), createDocument: jest.fn() };

beforeEach(() => {
  jest.resetAllMocks();
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'admin', role: 'admin', isActive: true });
  databases.getDocument.mockImplementation(async (_db, collection, id) => collection === COLLECTIONS.USERS
    ? { $id: id, role: 'agent', department: 'sales', isActive: true }
    : { userId: 'agent', feature: 'linkedin-helper', enabled: true });
});

it('rejects non-admin mutations before any database read', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'agent', role: 'agent', isActive: true });
  await expect(setLinkedinHelperBetaAccessAction('agent', true)).rejects.toThrow('Only active admins');
  expect(createAdminClient).not.toHaveBeenCalled();
});

it('enables and revokes the exact selected user in a server-managed record', async () => {
  databases.getDocument.mockImplementation(async (_db, collection, id) => collection === COLLECTIONS.USERS
    ? { $id: id, role: 'agent', department: 'sales', isActive: true }
    : { userId: 'agent', feature: 'linkedin-helper', enabled: false });
  databases.updateDocument.mockRejectedValueOnce({ code: 404 });
  await setLinkedinHelperBetaAccessAction('agent', true);
  expect(databases.createDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS,
    betaAccessDocumentId('agent'), { feature: 'linkedin-helper', userId: 'agent', enabled: true });
  expect(createNotificationsForRecipients).toHaveBeenCalledWith(databases, ['agent'], expect.objectContaining({
    type: 'LINKEDIN_HELPER_ACCESS', targetId: 'agent', targetType: 'linkedin_requests',
  }));
  expect(getNotificationUrl('agent', 'linkedin_requests')).toBe('/linkedin-requests');
  await setLinkedinHelperBetaAccessAction('agent', false);
  expect(databases.updateDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS,
    betaAccessDocumentId('agent'), { feature: 'linkedin-helper', userId: 'agent', enabled: false });
  expect(createNotificationsForRecipients).toHaveBeenCalledTimes(1);
});

it('does not notify again when access was already enabled', async () => {
  await setLinkedinHelperBetaAccessAction('agent', true);
  expect(createNotificationsForRecipients).not.toHaveBeenCalled();
});

it('checks the exact user and enabled flag rather than trusting the document ID alone', async () => {
  expect(await hasLinkedinHelperAccess(databases as never, 'agent')).toBe(true);
  databases.getDocument.mockResolvedValue({ userId: 'other', feature: 'linkedin-helper', enabled: true });
  expect(await hasLinkedinHelperAccess(databases as never, 'agent')).toBe(false);
  databases.getDocument.mockRejectedValue({ code: 404 });
  expect(await hasLinkedinHelperAccess(databases as never, 'agent')).toBe(false);
});
