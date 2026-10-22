import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { securityDatabase } from '@/lib/server/crm-access';
import { verifiedBrowserActor } from '@/lib/server/crm-browser-data';
import type { User } from '@/lib/types';
import { createBriefReadCache } from '@/lib/utils/brief-read-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const secretCollections = new Set([COLLECTIONS.SECURITY_CHALLENGES, COLLECTIONS.CRM_ACCESS_REQUESTS, COLLECTIONS.LEAD_HISTORY,
  COLLECTIONS.LINKEDIN_LEAD_REGISTRY, COLLECTIONS.MAINTENANCE_SETTINGS, COLLECTIONS.REPORT_EMAIL_SETTINGS, COLLECTIONS.BETA_FEATURE_ACCESS]);
// Share only empty-payload change markers, after fresh authorization and scope
// resolution. Chat/notification bodies and access decisions are never cached here.
const markers = createBriefReadCache<Awaited<ReturnType<typeof readChange>>>(30_000, 512);
const carriesMessageBody = (collectionId: string) =>
  [COLLECTIONS.NOTIFICATIONS, COLLECTIONS.CHAT_MESSAGES, COLLECTIONS.RESUME_CHAT_MESSAGES].includes(collectionId);

async function readChange(collectionId: string, queries: string[], bodyVisible: boolean) {
  const result = await securityDatabase().listDocuments(DATABASE_ID, collectionId, queries);
  const row = result.documents[0];
  return { version: createHash('sha256').update(`${result.total}:${row?.$id || ''}:${row?.$updatedAt || ''}`).digest('hex'),
    payload: bodyVisible && row ? row : {},
    createdAt: row?.$createdAt || '', updatedAt: row?.$updatedAt || '' };
}

async function changeFor(actor: User, collectionId: string) {
  const queries = [Query.orderDesc('$updatedAt'), Query.limit(1)];
  const bodyVisible = carriesMessageBody(collectionId);
  if (!bodyVisible) queries.push(Query.select(['$id', '$createdAt', '$updatedAt']));
  if (collectionId === COLLECTIONS.NOTIFICATIONS) queries.push(Query.equal('recipientId', actor.$id));
  if (collectionId === COLLECTIONS.CHAT_MESSAGES || collectionId === COLLECTIONS.RESUME_CHAT_MESSAGES) {
    const department = collectionId === COLLECTIONS.RESUME_CHAT_MESSAGES ? 'resume' : 'sales';
    if (!['admin', 'developer', 'monitor', 'operations'].includes(actor.role) && (actor.department || 'sales') !== department) return null;
  }
  if (collectionId === COLLECTIONS.LEADS) {
    if ((actor.department || 'sales') !== 'sales' && !['admin', 'developer', 'monitor', 'operations'].includes(actor.role)) return null;
    if (!['admin', 'developer', 'monitor', 'operations'].includes(actor.role)) {
      const { getLeadVisibilityUserIds } = await import('@/app/actions/lead/visibility');
      const ids = await getLeadVisibilityUserIds(securityDatabase(), actor.$id, actor.role);
      if (!ids.length) return null;
      queries.push(Query.or([Query.equal('ownerId', ids), Query.equal('assignedToId', ids)]));
    }
  }
  if (bodyVisible) return readChange(collectionId, queries, true);
  const key = createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, process.env.APPWRITE_API_KEY, DATABASE_ID, collectionId, queries])).digest('hex');
  return markers.read(key, () => readChange(collectionId, queries, false));
}

export async function GET(request: NextRequest) {
  try {
    await verifiedBrowserActor();
    const raw = request.nextUrl.searchParams.get('channels') || '[]';
    if (raw.length > 3000) throw new Error('Invalid subscription');
    const channels: unknown = JSON.parse(raw);
    if (!Array.isArray(channels) || channels.length > 12 || channels.some(channel => typeof channel !== 'string')) throw new Error('Invalid subscription');
    const parsed = channels.map((channel: string) => {
      const prefix = `databases.${DATABASE_ID}.collections.`;
      if (!channel.startsWith(prefix) || !channel.endsWith('.documents')) throw new Error('Invalid subscription');
      const collectionId = channel.slice(prefix.length, -'.documents'.length);
      if (!Object.values(COLLECTIONS).includes(collectionId) || secretCollections.has(collectionId)) throw new Error('Invalid subscription');
      return { channel, collectionId };
    });
    const encoder = new TextEncoder();
    let cancelStream = () => {};
    const stream = new ReadableStream({
      start(controller) {
        let stopped = false; let running = false;
        const previous = new Map<string, string>();
        const checkedAt = new Map<string, number>();
        const cleanup = () => { stopped = true; clearInterval(timer); clearTimeout(deadline); request.signal.removeEventListener('abort', end); };
        const end = () => { if (stopped) return; cleanup(); controller.close(); };
        cancelStream = cleanup;
        const send = (name: string, data: unknown) => { if (!stopped) controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); };
        const tick = async () => {
          if (running || stopped) return; running = true;
          try {
            const actor = await verifiedBrowserActor();
            for (const { channel, collectionId } of parsed) {
              const now = Date.now();
              if (!carriesMessageBody(collectionId) && now - (checkedAt.get(channel) ?? -Infinity) < 30_000) continue;
              checkedAt.set(channel, now);
              const change = await changeFor(actor, collectionId);
              if (!change || stopped) continue;
              const old = previous.get(channel); previous.set(channel, change.version);
              if (old === change.version) continue;
              send('message', { channels: [channel], version: change.version, payload: change.payload,
                timestamp: new Date().toISOString(), events: [`databases.${DATABASE_ID}.collections.${collectionId}.documents.${change.createdAt === change.updatedAt ? 'create' : 'update'}`] });
            }
          } catch { send('blocked', { reason: 'Access verification required' }); end(); }
          finally { running = false; }
        };
        const timer = setInterval(() => void tick(), 10_000);
        const deadline = setTimeout(end, 55_000);
        request.signal.addEventListener('abort', end, { once: true });
        void tick();
      },
      cancel() { cancelStream(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
  } catch { return NextResponse.json({ error: 'CRM access verification is required.' }, { status: 403 }); }
}
