/** @jest-environment node */
import { referenceDatabases } from '@/lib/services/reference-databases';
import { readCrmReferenceAction } from '@/app/actions/crm-reference';
import { databases } from '@/lib/appwrite';
jest.mock('@/lib/appwrite', () => ({ databases: { getDocument: jest.fn(), listDocuments: jest.fn() } }));
jest.mock('@/app/actions/crm-reference', () => ({ readCrmReferenceAction: jest.fn().mockResolvedValue({ documents: [] }) }));
const oldFlag = process.env.NEXT_PUBLIC_CRM_SERVER_DATA;
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_CRM_SERVER_DATA = 'true'; });
afterEach(() => { if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_CRM_SERVER_DATA; else process.env.NEXT_PUBLIC_CRM_SERVER_DATA = oldFlag; });
it('uses authorized in-process reads for server lookups instead of an HTTP request to localhost', async () => {
  await referenceDatabases.listDocuments('db', 'users', ['query']);
  await referenceDatabases.getDocument('db', 'users', 'person');
  expect(readCrmReferenceAction).toHaveBeenNthCalledWith(1, { databaseId: 'db', collectionId: 'users', queries: ['query'] });
  expect(readCrmReferenceAction).toHaveBeenNthCalledWith(2, { databaseId: 'db', collectionId: 'users', documentId: 'person' });
  expect(databases.listDocuments).not.toHaveBeenCalled(); expect(databases.getDocument).not.toHaveBeenCalled();
});
