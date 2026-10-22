describe('CRM change subscription read budget', () => {
  let subscribe: typeof import('@/lib/utils/crm-realtime-client').subscribeCrmChanges;
  let sources: Array<{ close: jest.Mock; listeners: Map<string, (event: unknown) => void> }>;
  let visible: boolean;
  const cleanups: Array<() => void> = [];

  beforeEach(async () => {
    jest.resetModules();
    sources = []; visible = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
    global.EventSource = jest.fn().mockImplementation(() => {
      const listeners = new Map();
      const source = { close: jest.fn(), listeners, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
      sources.push(source); return source;
    }) as unknown as typeof EventSource;
    ({ subscribeCrmChanges: subscribe } = await import('@/lib/utils/crm-realtime-client'));
  });
  afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

  it('shares one connection for concurrent and later identical subscriptions', async () => {
    cleanups.push(subscribe('leads', jest.fn()), subscribe('leads', jest.fn()));
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    cleanups.push(subscribe('leads', jest.fn()));
    await Promise.resolve();
    expect(sources).toHaveLength(1);
  });

  it('closes all background polling while hidden and resumes on visibility', async () => {
    cleanups.push(subscribe('leads', jest.fn()));
    await Promise.resolve();
    visible = false; document.dispatchEvent(new Event('visibilitychange'));
    expect(sources[0].close).toHaveBeenCalledTimes(1);
    cleanups.push(subscribe('notifications', jest.fn()));
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    visible = true; document.dispatchEvent(new Event('visibilitychange'));
    expect(sources).toHaveLength(2);
  });

  it('retains version comparison so changes made while hidden trigger refresh on return', async () => {
    const changed = jest.fn();
    cleanups.push(subscribe('leads', changed));
    await Promise.resolve();
    const event = (version: string) => ({ data: JSON.stringify({ channels: ['leads'], version, payload: {}, events: [], timestamp: '' }) });
    sources[0].listeners.get('message')!(event('before'));
    expect(changed).not.toHaveBeenCalled();
    visible = false; document.dispatchEvent(new Event('visibilitychange'));
    visible = true; document.dispatchEvent(new Event('visibilitychange'));
    sources[1].listeners.get('message')!(event('after'));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
