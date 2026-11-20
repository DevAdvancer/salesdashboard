'use server';

import { Query } from 'node-appwrite';
import { z } from 'zod';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { canReadAllLinkedinConversations, canReadLinkedinConversation, hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';
import { linkedinArchiveId, linkedinConversationId, saveLinkedinConversationMessage, type LinkedinConversationRecord } from '@/lib/server/linkedin-conversation-storage';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { getLinkedinRequestDateFilterValue } from '@/lib/utils/linkedin-request-dates';
import { normalizeProfileUrl } from '@/lib/utils/linkedin-extension-url';
import { LINKEDIN_CONVERSATION_PAYLOAD_LIMIT, LINKEDIN_MESSAGE_KINDS, LINKEDIN_MESSAGE_TEXT_LIMIT,
  type LinkedinConversationExportRow, type LinkedinConversationListItem } from '@/lib/types/linkedin-conversation';
import type { LinkedinRequest, User } from '@/lib/types';
import { buildLinkedinConversationExportRows, isInvitation, mergeRequests, projectLinkedinConversation, readLabels,
  readLinkedinInvitations, readTranscripts, requestFields } from '@/lib/server/linkedin-conversation-reads';
import { canSeeLinkedinReports, resolveLinkedinReportTeamLeadId, assertLinkedinReportTeamScope } from '@/app/actions/linkedin/shared';

const day = z.iso.date();
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/);
const rangeSchema = z.object({ mode: z.enum(['sent', 'accepted']), start: day, end: day,
  search: z.string().trim().max(300).optional() }).strict();
const referenceSchema = z.object({ requestId: id, conversationId: id }).strict();
const reportRangeSchema = rangeSchema.omit({ mode: true, search: true })
  .extend({ teamLeadId: id.nullable().optional() });
const messageSchema = referenceSchema.extend({ id: z.uuid(), date: day, direction: z.enum(LINKEDIN_MESSAGE_KINDS),
  text: z.string().refine(value => Boolean(value.trim())) });
type Range = z.input<typeof rangeSchema>;
type Reference = z.input<typeof referenceSchema>;
type Context = Awaited<ReturnType<typeof authorizedContext>>;
const RECENT_CONNECTIONS_LIMIT = 10;

async function authorizedContext() {
  const actor = await getAuthenticatedUserDoc();
  const { databases } = await createAdminClient();
  if (!await hasLinkedinConversationAccess(databases, actor)) throw new Error('LinkedIn Conversations access is required.');
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_CONVERSATIONS);
  return { actor, databases };
}

function canAppend(actor: User, request: LinkedinRequest) {
  return actor.role !== 'operations' && request.agentId === actor.$id && Boolean(request.acceptedAt || request.status === 'accepted');
}

function scopeQuery(actor: User) {
  if (canReadAllLinkedinConversations(actor)) return [];
  const owner = Query.equal('agentId', actor.$id);
  return [actor.role === 'team_lead' ? Query.or([owner, Query.equal('teamLeadId', actor.$id)]) : owner];
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

export async function getLinkedinConversationAction(ref: Reference) {
  const context = await authorizedContext();
  const { request } = await getRequest(context, ref);
  const conversation = projectLinkedinConversation(request, canAppend(context.actor, request));
  const transcripts = await readTranscripts(context.databases, [conversation.id]);
  return { conversation, ...transcripts.get(conversation.id)! };
}

export async function addLinkedinConversationMessageAction(input: z.input<typeof messageSchema>) {
  const context = await authorizedContext();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success || parsed.data.date > getCurrentEasternIsoDate()) throw new Error('Enter text and a valid date.');
  const { requestId, conversationId, ...message } = parsed.data;
  if (message.direction !== 'transcript') {
    message.text = message.text.trim();
    if (message.text.length > LINKEDIN_MESSAGE_TEXT_LIMIT) throw new Error('Use Paste conversation for longer text.');
  }
  if (Buffer.byteLength(JSON.stringify(message), 'utf8') > LINKEDIN_CONVERSATION_PAYLOAD_LIMIT) {
    throw new Error('This conversation is too long. Paste it in smaller sections.');
  }
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

async function withAgentNames(context: Context, requests: LinkedinRequest[]): Promise<LinkedinConversationListItem[]> {
  const ids = [...new Set(requests.map(request => request.agentId))].filter(id => id !== context.actor.$id);
  const users = await readLabels<Pick<User, '$id' | 'name'>>(context.databases, COLLECTIONS.USERS, ids, ['name']);
  return requests.map(request => ({ ...projectLinkedinConversation(request, canAppend(context.actor, request)), agent: request.agentId === context.actor.$id
    ? context.actor.name : users.get(request.agentId)?.name ?? request.agentId }));
}

async function listFilteredRequests(context: Context, input: Range, selection?: Set<string>) {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success || parsed.data.start > parsed.data.end) throw new Error('Choose a valid start and end date.');
  const { actor, databases } = context;
  const requests = await readLinkedinInvitations(databases, parsed.data, scopeQuery(actor),
    request => canReadLinkedinConversation(actor, request));
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
  if (!canReadAllLinkedinConversations(actor) && actor.role !== 'team_lead') throw new Error('Only team leads and leadership can see recent connections.');
  const queries = [Query.isNotNull('acceptedAt'), ...scopeQuery(actor), Query.orderDesc('acceptedAt'), Query.orderAsc('$id')];
  const options = { databases, databaseId: DATABASE_ID, requireComplete: true,
    pageLimit: RECENT_CONNECTIONS_LIMIT, take: RECENT_CONNECTIONS_LIMIT };
  const matches = (request: LinkedinRequest) => isInvitation(request) && canReadLinkedinConversation(actor, request);
  const current = await listAllDocuments<LinkedinRequest>({ ...options, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [...queries, Query.select(requestFields)], matches });
  const archive = await listAllDocuments<LinkedinConversationRecord>({ ...options, collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS,
    queries: [Query.equal('kind', 'archive'), ...queries, Query.select(['$id', 'payload'])],
    matches: row => matches(JSON.parse(row.payload) as LinkedinRequest) });
  return withAgentNames(context, mergeRequests(current, archive, 'accepted', matches).slice(0, RECENT_CONNECTIONS_LIMIT));
}

export async function exportLinkedinConversationsAction(input: Range, selectedIds?: string[]): Promise<LinkedinConversationExportRow[]> {
  const context = await authorizedContext();
  const selected = selectedIds === undefined ? undefined : z.array(id).max(5000).safeParse(selectedIds);
  if (selected && !selected.success) throw new Error('Choose valid LinkedIn requests.');
  const requests = await listFilteredRequests(context, input, selected ? new Set(selected.data) : undefined);
  return buildLinkedinConversationExportRows(context.databases, requests);
}

export async function exportLinkedinConversationReportAction(input: z.input<typeof reportRangeSchema>): Promise<LinkedinConversationExportRow[]> {
  const context = await authorizedContext();
  const { actor, databases } = context;
  if (!canSeeLinkedinReports(actor)) throw new Error('Only team leads and leadership can export conversation reports.');
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success || parsed.data.start > parsed.data.end) throw new Error('Choose a valid start and end date.');
  const teamLeadId = resolveLinkedinReportTeamLeadId(actor, parsed.data.teamLeadId);
  assertLinkedinReportTeamScope(actor, teamLeadId);
  const scope = teamLeadId ? [Query.or([Query.equal('teamLeadId', teamLeadId), Query.equal('agentId', teamLeadId)])] : [];
  const requests = await readLinkedinInvitations(databases, { ...parsed.data, mode: 'sent' }, scope,
    request => canReadLinkedinConversation(actor, request) &&
      (!teamLeadId || request.teamLeadId === teamLeadId || request.agentId === teamLeadId));
  const senders = await readLabels<Pick<User, '$id' | 'name' | 'department'>>(databases, COLLECTIONS.USERS,
    [...new Set(requests.map(request => request.agentId))], ['name', 'department']);
  const salesRequests = requests.filter(request => {
    const sender = senders.get(request.agentId);
    return sender && (sender.department ?? 'sales') === 'sales';
  });
  return buildLinkedinConversationExportRows(databases, salesRequests.map(request => ({
    ...projectLinkedinConversation(request, canAppend(actor, request)), agent: senders.get(request.agentId)!.name,
  })));
}
