describe('CRM change snapshot polling', () => {
  let subscribe: typeof import('@/lib/utils/crm-realtime-client').subscribeCrmChanges;
  let visible: boolean;
  let mockFetch: jest.Mock;
  const cleanups: Array<() => void> = [];
  const change = (version: string, channels = ['leads']) => ({ channels, version, payload: {}, events: [], timestamp: '' });
  const response = (changes: unknown[] = [], status = 200) => ({ ok: status === 200, status, json: async () => ({ changes }) });
  const flush = async () => { jest.runAllTicks(); for (let i = 0; i < 20; i++) await Promise.resolve(); };

  beforeEach(async () => {
    jest.resetModules(); jest.useFakeTimers();
    visible = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
    mockFetch = jest.fn().mockResolvedValue(response());
    global.fetch = mockFetch;
    ({ subscribeCrmChanges: subscribe } = await import('@/lib/utils/crm-realtime-client'));
  });
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    jest.useRealTimers();
  });

  it('batches concurrent subscriptions into one short request every 60 seconds', async () => {
    cleanups.push(subscribe('leads', jest.fn()), subscribe('leads', jest.fn()), subscribe('notifications', jest.fn()));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(mockFetch.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('mode')).toBe('poll');
    expect(JSON.parse(url.searchParams.get('channels')!)).toEqual(['leads', 'notifications']);
    cleanups.push(subscribe('leads', jest.fn())); await flush();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops while hidden and catches changes on return without replaying the first snapshot', async () => {
    const changed = jest.fn();
    mockFetch.mockResolvedValueOnce(response([change('before')]));
    cleanups.push(subscribe('leads', changed)); await flush();
    expect(changed).not.toHaveBeenCalled();
    visible = false; document.dispatchEvent(new Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(response([change('after')]));
    visible = true; document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('aborts hidden requests and ignores a late response from the old request', async () => {
    let finish!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const changed = jest.fn();
    cleanups.push(subscribe('leads', changed)); await flush();
    const signal = mockFetch.mock.calls[0][1].signal;
    visible = false; document.dispatchEvent(new Event('visibilitychange'));
    expect(signal.aborted).toBe(true);
    mockFetch.mockResolvedValueOnce(response([change('new-session')]));
    visible = true; document.dispatchEvent(new Event('visibilitychange')); await flush();
    finish(response([change('obsolete')])); await flush();
    expect(changed).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('stops on %s and recovers after session restoration', async status => {
    const recheck = jest.fn();
    window.addEventListener('crm-access-recheck', recheck);
    mockFetch.mockResolvedValueOnce(response([], status));
    cleanups.push(subscribe('leads', jest.fn())); await flush();
    expect(recheck).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(240_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('crm-session-restored')); await flush();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    window.removeEventListener('crm-access-recheck', recheck);
  });

  it('catches changes made during silent JWT recovery without resetting the mounted subscribers baseline', async () => {
    const changed = jest.fn();
    mockFetch.mockResolvedValueOnce(response([change('before-recovery')]))
      .mockResolvedValueOnce(response([], 401))
      .mockResolvedValueOnce(response([change('during-recovery')]));
    cleanups.push(subscribe('leads', changed)); await flush();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(changed).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('crm-session-restored')); await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ version: 'during-recovery' }));
  });

  it('clears the version baseline when subscribers unmount for a different sign-in', async () => {
    const previousChanged = jest.fn(); const nextChanged = jest.fn();
    mockFetch.mockResolvedValueOnce(response([change('previous-user')]));
    const remove = subscribe('leads', previousChanged); await flush(); remove();
    mockFetch.mockResolvedValueOnce(response([change('next-user')]));
    cleanups.push(subscribe('leads', nextChanged)); await flush();
    expect(previousChanged).not.toHaveBeenCalled();
    expect(nextChanged).not.toHaveBeenCalled();
  });

  it('backs off transient failures to at most four minutes and resets after recovery', async () => {
    mockFetch.mockResolvedValueOnce(response([], 503)).mockResolvedValueOnce(response([], 503));
    cleanups.push(subscribe('leads', jest.fn())); await flush();
    await jest.advanceTimersByTimeAsync(119_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(240_000);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('bounds stalled response bodies and never overlaps active requests', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(() => {}) });
    cleanups.push(subscribe('leads', jest.fn())); await flush();
    await jest.advanceTimersByTimeAsync(14_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('restarts for channel changes, dispatches changed versions once, and cleans up the final subscriber', async () => {
    const changed = jest.fn();
    mockFetch.mockResolvedValueOnce(response([change('first')]));
    const remove = subscribe('leads', changed); cleanups.push(remove); await flush();
    mockFetch.mockResolvedValueOnce(response([change('first'), change('n1', ['notifications'])]));
    cleanups.push(subscribe(['leads', 'notifications'], changed)); await flush();
    expect(changed).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(response([change('second', ['leads', 'notifications'])]));
    remove(); await flush();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(changed).toHaveBeenCalledTimes(1);
    cleanups.splice(0).forEach(cleanup => cleanup());
    await flush();
    expect(jest.getTimerCount()).toBe(0);
    const count = mockFetch.mock.calls.length;
    await jest.advanceTimersByTimeAsync(240_000);
    expect(mockFetch).toHaveBeenCalledTimes(count);
  });
});
