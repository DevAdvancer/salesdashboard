jest.mock('node-appwrite', () => ({ Query: {
  limit: (n: number) => `limit:${n}`, cursorAfter: (id: string) => `cursor:${id}`,
} }));
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

const input = { databaseId: 'db', collectionId: 'leads', queries: ['select:profile'], requireComplete: true };

it('uses one large page for a complete lead scan without changing the default for other callers', async () => {
  const databases = { listDocuments: jest.fn().mockResolvedValue({ total: 1945,
    documents: Array.from({ length: 1945 }, (_, i) => ({ $id: String(i) })) }) };
  expect(await listAllDocuments({ ...input, databases, pageLimit: 5000 })).toHaveLength(1945);
  expect(databases.listDocuments).toHaveBeenCalledTimes(1);
  expect(databases.listDocuments.mock.calls[0][2]).toContain('limit:5000');
  databases.listDocuments.mockResolvedValue({ total: 0, documents: [] });
  await listAllDocuments({ ...input, databases });
  expect(databases.listDocuments.mock.calls[1][2]).toContain('limit:100');
});

it('continues with cursors if a deployment silently caps large pages', async () => {
  const databases = { listDocuments: jest.fn()
    .mockResolvedValueOnce({ total: 3, documents: [{ $id: 'a' }, { $id: 'b' }] })
    .mockResolvedValueOnce({ total: 3, documents: [{ $id: 'c' }] }) };
  expect(await listAllDocuments({ ...input, databases, pageLimit: 5000 })).toHaveLength(3);
  expect(databases.listDocuments.mock.calls[1][2]).toContain('cursor:b');
});

it('falls back to 100 rows when larger pages are unsupported', async () => {
  const databases = { listDocuments: jest.fn().mockRejectedValueOnce({ code: 400 })
    .mockResolvedValueOnce({ total: 1, documents: [{ $id: 'a' }] }) };
  expect(await listAllDocuments({ ...input, databases, pageLimit: 5000 })).toEqual([{ $id: 'a' }]);
  expect(databases.listDocuments.mock.calls[1][2]).toContain('limit:100');
});

it.each([false, true])('fails closed when a capped scan cannot continue (missing cursor: %s)', async missingCursor => {
  const databases = { listDocuments: jest.fn().mockResolvedValue({ total: 10,
    documents: missingCursor ? [{}] : [] }) };
  await expect(listAllDocuments({ ...input, databases, pageLimit: 5000 })).rejects.toThrow('incomplete');
});

it('never returns a partial security scan at its page ceiling or after a database failure', async () => {
  const databases = { listDocuments: jest.fn().mockResolvedValue({ total: 2, documents: [{ $id: 'a' }] }) };
  await expect(listAllDocuments({ ...input, databases, pageLimit: 1, maxPages: 1 })).rejects.toThrow('safety limit');
  databases.listDocuments.mockRejectedValue(new Error('offline'));
  await expect(listAllDocuments({ ...input, databases, pageLimit: 5000 })).rejects.toThrow('offline');
});
it('bounds the total rows retained even when large pages are enabled', async () => {
  const databases = { listDocuments: jest.fn().mockResolvedValue({ total: 100, documents: [{ $id: 'a' }, { $id: 'b' }] }) };
  await expect(listAllDocuments({ ...input, databases, pageLimit: 5000, maxDocuments: 2 })).rejects.toThrow('safety limit');
});
