import fc from 'fast-check';
import { createReadThroughDatabases } from '@/lib/utils/appwrite-read-cache';
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { debug: jest.fn(), error: jest.fn() } }));
it('never shares identical collection/document IDs across databases', async () => {
  await fc.assert(fc.asyncProperty(fc.uuid(), fc.uuid(), async (one, two) => {
    fc.pre(one !== two);
    const source = { getDocument: jest.fn(async (database: string) => ({ database })) };
    const db = createReadThroughDatabases(source);
    expect(await db.getDocument(one, 'users', 'person')).toEqual({ database: one });
    expect(await db.getDocument(two, 'users', 'person')).toEqual({ database: two });
    expect(source.getDocument).toHaveBeenCalledTimes(2);
  }), { numRuns: 20 });
});
