/** @jest-environment node */
import fc from 'fast-check';
import { memoizeCrmRequest, withCrmRequestContext } from '@/lib/server/crm-request-context';

it('shares authorization reads only inside the same HTTP operation and revalidates the next operation', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 20 }), async repeats => {
    const key = Symbol('identity'); let active = true;
    const read = jest.fn(async () => active);
    await withCrmRequestContext(async () => {
      for (let i = 0; i < repeats; i++) expect(await memoizeCrmRequest(key, read)).toBe(true);
    });
    expect(read).toHaveBeenCalledTimes(1);
    active = false;
    expect(await withCrmRequestContext(() => memoizeCrmRequest(key, read))).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  }), { numRuns: 20 });
});

it('isolates simultaneous operations even when they use the same memoization key', async () => {
  const key = Symbol('identity');
  const run = (id: string) => withCrmRequestContext(async () => {
    const read = jest.fn(async () => { await Promise.resolve(); return id; });
    expect(await memoizeCrmRequest(key, read)).toBe(id);
    expect(await memoizeCrmRequest(key, read)).toBe(id);
    expect(read).toHaveBeenCalledTimes(1);
  });
  await Promise.all([run('person-a'), run('person-b')]);
});

it('fails closed on failed reads and never retains them after the operation', async () => {
  const key = Symbol('identity'); const read = jest.fn().mockRejectedValueOnce(new Error('revoked')).mockResolvedValueOnce('fresh');
  await withCrmRequestContext(async () => {
    await expect(memoizeCrmRequest(key, read)).rejects.toThrow('revoked');
    await expect(memoizeCrmRequest(key, read)).rejects.toThrow('revoked');
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(await withCrmRequestContext(() => memoizeCrmRequest(key, read))).toBe('fresh');
});

it('does not cache unscoped reads', async () => {
  const read = jest.fn(async () => true);
  const key = Symbol('identity');
  await memoizeCrmRequest(key, read); await memoizeCrmRequest(key, read);
  expect(read).toHaveBeenCalledTimes(2);
});
