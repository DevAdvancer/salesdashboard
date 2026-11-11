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
import { LINKEDIN_MESSAGE_TEXT_LIMIT, type LinkedinConversation, type LinkedinConversationExportRow, type LinkedinConversationListItem, type LinkedinConversationMessage } from '@/lib/types/linkedin-conversation';
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
type AccountLabel = Pick<LinkedinAccount, '$id' | 'idName' | 'accountType' | 'mainAccountId'>;
const RECENT_CONNECTIONS_LIMIT = 10;
const requestFields = ['$id', 'conversationId', 'agentId', 'accountId', 'teamLeadId', 'company', 'targetUrl',
  'dateSent', 'acceptedAt', 'withdrawnAt', 'status', 'isActive', 'coldCall', 'recordSource'];

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

function mergeRequests(actor: User, current: LinkedinRequest[], archive: LinkedinConversationRecord[], mode: Range['mode']) {
  const requests = new Map<string, LinkedinRequest>();
  for (const request of [...archive.map(row => JSON.parse(row.payload) as LinkedinRequest), ...current]) {
    if (isInvitation(request) && canReadLinkedinConversation(actor, request)) requests.set(linkedinConversationId(request), request);
  }
  const dateField = mode === 'sent' ? 'dateSent' : 'acceptedAt';
  return [...requests.values()].sort((left, right) => (right[dateField] || '').localeCompare(left[dateField] || '') ||
    left.$id.localeCompare(right.$id) || linkedinConversationId(left).localeCompare(linkedinConversationId(right)));
}

async function listRequests({ actor, databases }: Context, input: Range) {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success || parsed.data.start > parsed.data.end) throw new Error('Choose a valid start and end date.');
  const { start, end, mode } = parsed.data;
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
  const current = await listAllDocuments<LinkedinRequest>({ ...options, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [...scoped, Query.select(requestFields)] });
  const archive = await listAllDocuments<LinkedinConversationRecord>({ ...options, collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS,
    queries: [Query.equal('kind', 'archive'), ...scoped, Query.select(['$id', 'payload'])] });
  return mergeRequests(actor, current, archive, mode);
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

async function readLabels<T extends { $id: string }>(context: Context, collectionId: string, ids: string[], fields: string[]) {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    rows.push(...await listAllDocuments<T>({ databases: context.databases, databaseId: DATABASE_ID, collectionId,
      queries: [Query.equal('$id', ids.slice(start, start + 100)), Query.select(['$id', ...fields])], requireComplete: true }));
  }
  return new Map(rows.map(row => [row.$id, row]));
}

async function withAgentNames(context: Context, requests: LinkedinRequest[]): Promise<LinkedinConversationListItem[]> {
  const ids = [...new Set(requests.map(request => request.agentId))].filter(id => id !== context.actor.$id);
  const users = await readLabels<Pick<User, '$id' | 'name'>>(context, COLLECTIONS.USERS, ids, ['name']);
  return requests.map(request => ({ ...project(context.actor, request), agent: request.agentId === context.actor.$id
    ? context.actor.name : users.get(request.agentId)?.name ?? request.agentId }));
}

async function listFilteredRequests(context: Context, input: Range, selection?: Set<string>) {
  const requests = await listRequests(context, input);
  const rows = await withAgentNames(context, selection ? requests.filter(request => selection.has(linkedinConversationId(request))) : requests);
  const term = input.search?.trim().toLowerCase();
  if (!term) return rows;
  let profileTerm = term.replace(/\s+/g, '-');
  try { profileTerm = new URL(normalizeProfileUrl(term)).pathname.toLowerCase(); } catch { /* Match partial profile text. */ }
  return rows.filter(row => row.agent.toLowerCase().includes(term) || row.company.toLowerCase().includes(term) ||
    row.targetUrl.toLowerCase().includes(profileTerm));
}

export async function listLinkedinConversationsAction(input: Range) {
  return listFilteredRequests(await authorizedContext(), input);
}

export async function listRecentLinkedinConnectionsAction() {
  const context = await authorizedContext();
  const { actor, databases } = context;
  if (actor.role !== 'admin' && actor.role !== 'team_lead') throw new Error('Only team leads and admins can see recent connections.');
  const queries = [Query.isNotNull('acceptedAt'), ...scopeQuery(actor), Query.orderDesc('acceptedAt'), Query.orderAsc('$id')];
  const options = { databases, databaseId: DATABASE_ID, requireComplete: true,
    pageLimit: RECENT_CONNECTIONS_LIMIT, take: RECENT_CONNECTIONS_LIMIT };
  const matches = (request: LinkedinRequest) => isInvitation(request) && canReadLinkedinConversation(actor, request);
  const current = await listAllDocuments<LinkedinRequest>({ ...options, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [...queries, Query.select(requestFields)], matches });
  const archive = await listAllDocuments<LinkedinConversationRecord>({ ...options, collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS,
    queries: [Query.equal('kind', 'archive'), ...queries, Query.select(['$id', 'payload'])],
    matches: row => matches(JSON.parse(row.payload) as LinkedinRequest) });
  return withAgentNames(context, mergeRequests(actor, current, archive, 'accepted').slice(0, RECENT_CONNECTIONS_LIMIT));
}

export async function exportLinkedinConversationsAction(input: Range, selectedIds?: string[]): Promise<LinkedinConversationExportRow[]> {
  const context = await authorizedContext();
  const selected = selectedIds === undefined ? undefined : z.array(id).max(5000).safeParse(selectedIds);
  if (selected && !selected.success) throw new Error('Choose valid LinkedIn requests.');
  const requests = await listFilteredRequests(context, input, selected ? new Set(selected.data) : undefined);
  const [transcripts, accounts] = await Promise.all([
    readTranscripts(context, requests.map(request => request.id)),
    readLabels<AccountLabel>(context, COLLECTIONS.LINKEDIN_ACCOUNTS, [...new Set(requests.map(request => request.accountId))], ['idName', 'accountType', 'mainAccountId']),
  ]);
  const missingMainIds = [...new Set([...accounts.values()].flatMap(account =>
    account.accountType === 'sudo' && account.mainAccountId && !accounts.has(account.mainAccountId) ? [account.mainAccountId] : []))];
  const mainAccounts = await readLabels<AccountLabel>(context, COLLECTIONS.LINKEDIN_ACCOUNTS, missingMainIds, ['idName']);
  return requests.map(request => {
    const account = accounts.get(request.accountId);
    const sudo = account?.accountType === 'sudo';
    const mainAccountId = sudo ? account.mainAccountId ?? '' : account?.$id ?? '';
    return { ...request, ...transcripts.get(request.id)!, accountType: account?.accountType ?? null, mainAccountId,
      mainAccount: accounts.get(mainAccountId)?.idName ?? mainAccounts.get(mainAccountId)?.idName ?? '',
      sudoAccountId: sudo ? account.$id : '', sudoAccount: sudo ? account.idName : '' };
  });
}
