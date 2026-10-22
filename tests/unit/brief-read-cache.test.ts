import { createBriefReadCache } from '@/lib/utils/brief-read-cache';

describe('brief advisory read cache', () => {
  afterEach(() => jest.restoreAllMocks());

  it('collapses concurrent and repeated loads, then reloads after expiry', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = createBriefReadCache<number>(60_000, 2);
    const load = jest.fn().mockResolvedValue(1);
    await Promise.all(Array.from({ length: 100 }, () => cache.read('same', load)));
    expect(load).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(61_000);
    await cache.read('same', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('bounds entries and separates scopes', async () => {
    const cache = createBriefReadCache<number>(60_000, 2);
    const load = jest.fn().mockResolvedValue(1);
    await cache.read('one', load);
    await cache.read('two', load);
    await cache.read('three', load);
    await cache.read('one', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not cache failures or allow an invalidated in-flight read to replace new data', async () => {
    const cache = createBriefReadCache<number>(60_000, 2);
    await expect(cache.read('key', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    let reject!: (error: Error) => void;
    const old = cache.read('key', () => new Promise<number>((_resolve, fail) => { reject = fail; }));
    await Promise.resolve();
    cache.clear();
    await expect(cache.read('key', async () => 2)).resolves.toBe(2);
    reject(new Error('old'));
    await expect(old).rejects.toThrow('old');
    await expect(cache.read('key', async () => 3)).resolves.toBe(2);
  });
});
