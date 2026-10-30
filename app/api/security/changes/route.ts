import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { CrmAccessError, securityDatabase } from '@/lib/server/crm-access';
import { verifiedBrowserActor } from '@/lib/server/crm-browser-data';
import type { User } from '@/lib/types';
import { createBriefReadCache } from '@/lib/utils/brief-read-cache';
import { appwriteCacheKey } from '@/lib/server/appwrite-cache-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const secretCollections = new Set([COLLECTIONS.SECURITY_CHALLENGES, COLLECTIONS.CRM_ACCESS_REQUESTS, COLLECTIONS.LEAD_HISTORY,
  COLLECTIONS.LINKEDIN_LEAD_REGISTRY, COLLECTIONS.REPORT_EMAIL_SETTINGS, COLLECTIONS.BETA_FEATURE_ACCESS]);
// Share only empty-payload change markers, after fresh authorization and scope
// resolution. Chat/notification bodies and access decisions are never cached here.
const markers = createBriefReadCache<Awaited<ReturnType<typeof readChange>>>(60_000, 512);
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
  const key = appwriteCacheKey('change-markers', DATABASE_ID, collectionId, queries);
  return markers.read(key, () => readChange(collectionId, queries, false));
}

export async function GET(request: NextRequest) {
  try {
    // Authorize every snapshot, even with warm markers. Return after useful work:
    // sleeping SSE loops keep provisioned function memory occupied while idle.
    const actor = await verifiedBrowserActor();
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
    const unique = [...new Map(parsed.map(item => [item.channel, item])).values()];
    const changes = (await Promise.all(unique.map(async ({ channel, collectionId }) => {
      const change = await changeFor(actor, collectionId);
      if (!change) return null;
      return { channels: [channel], version: change.version, payload: change.payload,
        timestamp: new Date().toISOString(), events: [`databases.${DATABASE_ID}.collections.${collectionId}.documents.${change.createdAt === change.updatedAt ? 'create' : 'update'}`] };
    }))).filter(change => change !== null);
    const headers = { 'Cache-Control': 'private, no-store' };
    if (request.nextUrl.searchParams.get('mode') === 'poll') {
      return NextResponse.json({ changes }, { headers });
    }
    // Old tabs still use EventSource. A finite snapshot and explicit retry delay
    // remove their idle loop too, without the default rapid reconnection cycle.
    const events = changes.map(change => `event: message\ndata: ${JSON.stringify(change)}\n\n`).join('');
    return new Response(`retry: 60000\n\n${events}`, { headers: {
      ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no',
    } });
  } catch (error) {
    const invalid = error instanceof Error && (error.message === 'Invalid subscription' || error instanceof SyntaxError);
    const status = error instanceof CrmAccessError ? error.status : invalid ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? 'Change checks are temporarily unavailable.' : 'CRM access verification is required.' },
      { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
