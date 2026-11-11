'use server';

import { Query } from 'node-appwrite';
import { z } from 'zod';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { canReadLinkedinConversation, hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';
import { linkedinArchiveId, linkedinConversationId, linkedinConversationRecordQueries, saveLinkedinConversationMessage, type LinkedinConversationRecord } from '@/lib/server/linkedin-conversation-storage';
import { easternWallTimeToIso, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { getLinkedinRequestDateFilterValue, linkedinRequestDateBounds } from '@/lib/utils/linkedin-request-dates';
import { isWithdrawnLinkedinRequest } from '@/lib/utils/linkedin-request-state';
import { normalizeProfileUrl } from '@/lib/utils/linkedin-extension-url';
import { LINKEDIN_MESSAGE_TEXT_LIMIT, type LinkedinConversation, type LinkedinConversationMessage } from '@/lib/types/linkedin-conversation';
import type { LinkedinAccount, LinkedinRequest, User } from '@/lib/types';

const day = z.iso.date();
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/);
const rangeSchema = z.object({ mode: z.enum(['sent', 'accepted']), start: day, end: day,
  search: z.string().trim().max(300).optional() }).strict();
const referenceSchema = z.object({ requestId: id, conversationId: id }).strict();
const messageSchema = referenceSchema.extend({ id: z.uuid(), date: day, direction: z.enum(['sent', 'received']),
  text: z.string().trim().min(1).max(LINKEDIN_MESSAGE_TEXT_LIMIT) });
type Range = z.input<typeof rangeSchema>;
type Reference = z.input<typeof referenceSchema>;
type Context = Awaited<ReturnType<typeof authorizedContext>>;

async function authorizedContext() {
  const actor = await getAuthenticatedUserDoc();
  const { databases } = await createAdminClient();
  if (!await hasLinkedinConversationAccess(databases, actor)) throw new Error('LinkedIn Conversations beta access is required.');
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_CONVERSATIONS);
  return { actor, databases };
}

function isInvitation(request: LinkedinRequest) {
  return !request.coldCall && request.recordSource !== 'lead_backfill';
}

function canAppend(actor: User, request: LinkedinRequest) {
  return request.agentId === actor.$id && Boolean(request.acceptedAt || request.status === 'accepted');
}

function project(actor: User, request: LinkedinRequest): LinkedinConversation {
  return { id: linkedinConversationId(request), requestId: request.$id, agentId: request.agentId,
    accountId: request.accountId, company: request.company, targetUrl: request.targetUrl, dateSent: request.dateSent,
    acceptedAt: request.acceptedAt, withdrawnAt: request.withdrawnAt || null,
    status: isWithdrawnLinkedinRequest(request) ? 'withdrawn' : request.status, canAppend: canAppend(actor, request) };
}

function scopeQuery(actor: User) {
  if (actor.role === 'admin') return [];
  const owner = Query.equal('agentId', actor.$id);
  return [actor.role === 'team_lead' ? Query.or([owner, Query.equal('teamLeadId', actor.$id)]) : owner];
}

async function listRequests({ actor, databases }: Context, input: Range) {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success || parsed.data.start > parsed.data.end) throw new Error('Choose a valid start and end date.');
  const { start, end, mode, search } = parsed.data;
  const from = linkedinRequestDateBounds(start).start;
  const until = linkedinRequestDateBounds(end).endExclusive;
  const queries = mode === 'sent' ? [Query.greaterThanEqual('dateSent', from), Query.lessThan('dateSent', until)] : [
    Query.greaterThanEqual('acceptedAt', easternWallTimeToIso(`${start}T00:00`)),
    Query.lessThan('acceptedAt', easternWallTimeToIso(`${until.slice(0, 10)}T00:00`)),
  ];
  const options = { databases, databaseId: DATABASE_ID, requireComplete: true };
  const scoped = [...queries, ...scopeQuery(actor), Query.orderAsc('$id')];
  // A resend archives the old attempt before replacing the live pointer.
  // Read live requests first so a concurrent resend cannot fall between scans.
  const current = await listAllDocuments<LinkedinRequest>({ ...options, collectionId: COLLECTIONS.LINKEDIN_REQUESTS, queries: scoped });
  const archive = await listAllDocuments<LinkedinConversationRecord>({ ...options, collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS,
    queries: [Query.equal('kind', 'archive'), ...scoped] });
  const requests = new Map<string, LinkedinRequest>();
  for (const request of [...archive.map(row => JSON.parse(row.payload) as LinkedinRequest), ...current]) {
    if (isInvitation(request) && canReadLinkedinConversation(actor, request)) requests.set(linkedinConversationId(request), request);
  }
  const term = search?.toLowerCase();
  let profileTerm = term;
  if (term) {
    try { profileTerm = new URL(normalizeProfileUrl(term)).pathname.toLowerCase(); } catch { /* Match partial searches as entered. */ }
  }
  return [...requests.values()].filter(request => !term || request.company.toLowerCase().includes(term) || request.targetUrl.toLowerCase().includes(profileTerm!))
    .sort((left, right) => ((mode === 'sent' ? right.dateSent : right.acceptedAt) || '').localeCompare(
      (mode === 'sent' ? left.dateSent : left.acceptedAt) || '') || linkedinConversationId(left).localeCompare(linkedinConversationId(right)));
}

async function getRequest({ actor, databases }: Context, ref: Reference) {
  const parsed = referenceSchema.safeParse(ref);
  if (!parsed.success) throw new Error('Choose a valid LinkedIn request.');
  const { requestId, conversationId } = parsed.data;
  const missing = (error: unknown) => {
    if ((error as { code?: number }).code !== 404) throw error;
    return null;
  };
  const current = await databases.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, requestId).catch(missing) as unknown as LinkedinRequest | null;
  let request = current;
  if (!current || linkedinConversationId(current) !== conversationId) {
    const archived = await databases.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, linkedinArchiveId(conversationId)).catch(missing);
    request = archived ? JSON.parse(archived.payload) as LinkedinRequest : null;
  }
  if (!request || request.$id !== requestId || linkedinConversationId(request) !== conversationId ||
      !isInvitation(request) || !canReadLinkedinConversation(actor, request)) throw new Error('LinkedIn conversation is unavailable.');
  return { request, current: request === current };
}

async function readTranscripts({ databases }: Context, ids: string[]) {
  const transcripts = new Map(ids.map(conversationId => [conversationId, { initialText: '', messages: [] as LinkedinConversationMessage[] }]));
  for (let start = 0; start < ids.length; start += 100) {
    const rows = await listAllDocuments<LinkedinConversationRecord>({ databases, databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS, requireComplete: true,
      queries: [...linkedinConversationRecordQueries(ids.slice(start, start + 100)), Query.orderAsc('$createdAt'), Query.orderAsc('$id')] });
    for (const row of rows) {
      const transcript = transcripts.get(row.conversationId);
      if (!transcript) continue;
      if (row.kind === 'invitation') transcript.initialText = row.payload;
      if (row.kind === 'message') transcript.messages.push(JSON.parse(row.payload) as LinkedinConversationMessage);
    }
  }
  for (const transcript of transcripts.values()) transcript.messages.sort((left, right) => left.date.localeCompare(right.date));
  return transcripts;
}

export async function listLinkedinConversationsAction(input: Range) {
  const context = await authorizedContext();
  return (await listRequests(context, input)).map(request => project(context.actor, request));
}

export async function getLinkedinConversationAction(ref: Reference) {
  const context = await authorizedContext();
  const { request } = await getRequest(context, ref);
  const conversation = project(context.actor, request);
  const transcripts = await readTranscripts(context, [conversation.id]);
  return { conversation, ...transcripts.get(conversation.id)! };
}

export async function addLinkedinConversationMessageAction(input: z.input<typeof messageSchema>) {
  const context = await authorizedContext();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success || parsed.data.date > getCurrentEasternIsoDate()) throw new Error('Enter a message and a valid date.');
  const { requestId, conversationId, ...message } = parsed.data;
  const { request, current } = await getRequest(context, { requestId, conversationId });
  if (!canAppend(context.actor, request)) throw new Error('Only the agent who recorded the accepted request can add messages.');
  if (message.date < getLinkedinRequestDateFilterValue(request.dateSent)) throw new Error('Choose a date on or after the invitation was sent.');
  if (current && !request.conversationId) {
    await context.databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, requestId, {
      conversationId, expectedRequestUpdatedAt: request.$updatedAt,
    });
  }
  await saveLinkedinConversationMessage(context.databases, conversationId, message);
}

async function readLabels<T extends { $id: string }>(context: Context, collectionId: string, ids: string[], field: string) {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    rows.push(...await listAllDocuments<T>({ databases: context.databases, databaseId: DATABASE_ID, collectionId,
      queries: [Query.equal('$id', ids.slice(start, start + 100)), Query.select(['$id', field])], requireComplete: true }));
  }
  return new Map(rows.map(row => [row.$id, row]));
}

export async function exportLinkedinConversationsAction(input: Range, selectedIds?: string[]) {
  const context = await authorizedContext();
  const selected = selectedIds === undefined ? undefined : z.array(id).max(5000).safeParse(selectedIds);
  if (selected && !selected.success) throw new Error('Choose valid LinkedIn requests.');
  const selection = selected ? new Set(selected.data) : null;
  const requests = (await listRequests(context, input)).filter(request => !selection || selection.has(linkedinConversationId(request)));
  const [transcripts, users, accounts] = await Promise.all([
    readTranscripts(context, requests.map(linkedinConversationId)),
    readLabels<Pick<User, '$id' | 'name'>>(context, COLLECTIONS.USERS, [...new Set(requests.map(request => request.agentId))], 'name'),
    readLabels<Pick<LinkedinAccount, '$id' | 'idName'>>(context, COLLECTIONS.LINKEDIN_ACCOUNTS, [...new Set(requests.map(request => request.accountId))], 'idName'),
  ]);
  return requests.map(request => ({ ...project(context.actor, request), ...transcripts.get(linkedinConversationId(request))!,
    agent: users.get(request.agentId)?.name ?? request.agentId, account: accounts.get(request.accountId)?.idName ?? request.accountId }));
}
