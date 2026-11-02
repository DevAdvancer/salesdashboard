import { createHash } from 'node:crypto';

// Bounded, best-effort limits per running server instance. No per-view DB writes/timers.
let start = 0;
let total = 0;
const counts = new Map<string, number>();
export function allowClientCardRead(ip: string, shareId: string, now = Date.now()) {
  if (now < start || now - start >= 60_000) { start = now; total = 0; counts.clear(); }
  const ipKey = `ip:${createHash('sha256').update(ip.slice(0, 128)).digest('hex')}`;
  const shareKey = `share:${shareId}`;
  if (total >= 120 || (counts.get(ipKey) || 0) >= 30 || (counts.get(shareKey) || 0) >= 60) return false;
  total++; counts.set(ipKey, (counts.get(ipKey) || 0) + 1); counts.set(shareKey, (counts.get(shareKey) || 0) + 1);
  return true;
}
