import { withClientTimeout } from '@/lib/utils/client-timeout';

type Change = { channels: string[]; events: string[]; timestamp: string; payload: Record<string, unknown>; version: string };
const subscriptions = new Map<number, { channels: string[]; callback: (event: Change) => void }>();
const versions = new Map<string, string>();
const POLL_MS = 60_000;
const MAX_RETRY_MS = 240_000;
let sequence = 0;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let activeChannels = '';
let reconnectQueued = false;
let watchingVisibility = false;
let blocked = false;
let failures = 0;

function scheduleReconnect() {
  if (reconnectQueued) return;
  reconnectQueued = true;
  queueMicrotask(() => { reconnectQueued = false; reconnect(); });
}

function stop() {
  clearTimeout(timer); timer = undefined;
  controller?.abort(); controller = null;
  activeChannels = '';
}

function deliver(event: Change) {
  const changed = event.channels.filter(channel => {
    const previous = versions.get(channel);
    versions.set(channel, event.version);
    return previous !== undefined && previous !== event.version;
  });
  if (!changed.length) return;
  for (const subscription of subscriptions.values()) {
    if (subscription.channels.some(channel => changed.includes(channel))) {
      try { subscription.callback(event); } catch (error) { console.error('CRM change callback failed', error); }
    }
  }
}

async function poll(key: string) {
  const current = new AbortController();
  controller = current;
  try {
    const response = await withClientTimeout(async signal => {
      const result = await fetch(`/api/security/changes?${new URLSearchParams({ channels: key, mode: 'poll' })}`, {
        signal, cache: 'no-store', credentials: 'same-origin',
      });
      if (result.status === 401 || result.status === 403) return { blocked: true as const, changes: [] };
      if (!result.ok) throw new Error('Change check failed');
      const body: { changes: Change[] } = await result.json();
      if (!Array.isArray(body.changes)) throw new Error('Invalid change response');
      return { blocked: false as const, changes: body.changes };
    }, 15_000, 'Change check timed out', current.signal);
    if (current.signal.aborted || controller !== current) return;
    if (response.blocked) {
      blocked = true;
      stop();
      // JWT recovery can keep the same subscribers mounted. Preserve their last
      // snapshot so changes during recovery trigger a refresh on reconnect.
      // Unsubscribing the final listener still clears the baseline on sign-out.
      window.dispatchEvent(new Event('crm-access-recheck'));
      return;
    }
    failures = 0;
    for (const event of response.changes) {
      if (current.signal.aborted || controller !== current) return;
      deliver(event);
    }
  } catch {
    if (current.signal.aborted || controller !== current) return;
    failures++;
  } finally {
    if (controller === current) {
      controller = null;
      // Schedule after completion; slow requests and response bodies never overlap.
      timer = setTimeout(() => void poll(key), Math.min(POLL_MS * 2 ** Math.min(failures, 2), MAX_RETRY_MS));
    }
  }
}

function reconnect() {
  const channels = [...new Set([...subscriptions.values()].flatMap(item => item.channels))].sort();
  const nextChannels = JSON.stringify(channels);
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!hidden && activeChannels === nextChannels) return;
  stop();
  if (!channels.length || hidden || blocked || typeof fetch === 'undefined') return;
  activeChannels = nextChannels;
  failures = 0;
  void poll(nextChannels);
}

function resume() {
  blocked = false;
  reconnect();
}

export function subscribeCrmChanges(channels: string | string[], callback: (event: Change) => void) {
  const id = ++sequence;
  subscriptions.set(id, { channels: Array.isArray(channels) ? channels : [channels], callback });
  if (!watchingVisibility && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('crm-session-restored', resume);
    watchingVisibility = true;
  }
  scheduleReconnect();
  return () => {
    subscriptions.delete(id);
    if (!subscriptions.size) {
      stop();
      versions.clear(); blocked = false; failures = 0;
      if (watchingVisibility) document.removeEventListener('visibilitychange', resume);
      if (watchingVisibility) window.removeEventListener('crm-session-restored', resume);
      watchingVisibility = false;
    } else scheduleReconnect();
  };
}
