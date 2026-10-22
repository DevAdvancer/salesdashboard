import { withServerOwnedPermissions } from '@/lib/server/server-owned-permissions';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';

it.each([COLLECTIONS.USERS, COLLECTIONS.ATTENDANCE])('keeps %s browser-read scope while removing all browser-write grants', async collection => {
  const raw = {
    createDocument: jest.fn(), updateDocument: jest.fn(),
    getDocument: jest.fn().mockResolvedValue({ $permissions: ['read("user:person")', 'update("user:person")', 'delete("users")'] }),
  } as unknown as Databases;
  const guarded = withServerOwnedPermissions(raw);
  await guarded.createDocument(DATABASE_ID, collection, 'person', { name: 'Person' }, ['read("users")', 'update("users")']);
  await guarded.updateDocument(DATABASE_ID, collection, 'person', { name: 'Changed' });
  expect(raw.createDocument).toHaveBeenCalledWith(DATABASE_ID, collection, 'person', { name: 'Person' }, ['read("users")']);
  expect(raw.updateDocument).toHaveBeenCalledWith(DATABASE_ID, collection, 'person', { name: 'Changed' }, ['read("user:person")']);
});
