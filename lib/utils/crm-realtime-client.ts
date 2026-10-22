type Change = { channels: string[]; events: string[]; timestamp: string; payload: Record<string, unknown>; version: string };
const subscriptions = new Map<number, { channels: string[]; callback: (event: Change) => void }>();
const versions = new Map<string, string>();
let sequence = 0;
let source: EventSource | null = null;

function reconnect() {
  source?.close(); source = null;
  const channels = [...new Set([...subscriptions.values()].flatMap(item => item.channels))];
  if (!channels.length || typeof EventSource === 'undefined') return;
  source = new EventSource(`/api/security/changes?${new URLSearchParams({ channels: JSON.stringify(channels) })}`);
  source.addEventListener('message', message => {
    let event: Change;
    try { event = JSON.parse((message as MessageEvent).data); } catch { return; }
    for (const channel of event.channels) {
      const previous = versions.get(channel);
      versions.set(channel, event.version);
      if (!previous || previous === event.version) continue;
      for (const subscription of subscriptions.values()) {
        if (subscription.channels.includes(channel)) subscription.callback(event);
      }
    }
  });
  source.addEventListener('blocked', () => {
    source?.close(); source = null;
    window.dispatchEvent(new Event('crm-access-recheck'));
  });
}
export function subscribeCrmChanges(channels: string | string[], callback: (event: Change) => void) {
  const id = ++sequence;
  subscriptions.set(id, { channels: Array.isArray(channels) ? channels : [channels], callback });
  reconnect();
  return () => { subscriptions.delete(id); reconnect(); };
}
