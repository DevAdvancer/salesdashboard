import { Query, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { linkedinConversationId, linkedinConversationRecordQueries, type LinkedinConversationRecord } from '@/lib/server/linkedin-conversation-storage';
import type { LinkedinAccount, LinkedinRequest } from '@/lib/types';
import type { LinkedinConversation, LinkedinConversationExportRow, LinkedinConversationListItem, LinkedinConversationMessage, LinkedinConversationMode } from '@/lib/types/linkedin-conversation';
import { easternWallTimeToIso } from '@/lib/utils/eastern-date';
import { linkedinRequestDateBounds } from '@/lib/utils/linkedin-request-dates';
import { isWithdrawnLinkedinRequest } from '@/lib/utils/linkedin-request-state';

type AccountLabel = Pick<LinkedinAccount, '$id' | 'idName' | 'accountType' | 'mainAccountId'>;
export const requestFields = ['$id', 'conversationId', 'agentId', 'accountId', 'teamLeadId', 'company', 'targetUrl',
  'dateSent', 'acceptedAt', 'withdrawnAt', 'status', 'isActive', 'coldCall', 'recordSource'];

export function projectLinkedinConversation(request: LinkedinRequest, canAppend: boolean): LinkedinConversation {
  return { id: linkedinConversationId(request), requestId: request.$id, agentId: request.agentId,
    accountId: request.accountId, company: request.company, targetUrl: request.targetUrl, dateSent: request.dateSent,
    acceptedAt: request.acceptedAt, withdrawnAt: request.withdrawnAt || null,
    status: isWithdrawnLinkedinRequest(request) ? 'withdrawn' : request.status, canAppend };
}

export function isInvitation(request: LinkedinRequest) {
  return !request.coldCall && request.recordSource !== 'lead_backfill';
}

export function mergeRequests(current: LinkedinRequest[], archive: LinkedinConversationRecord[],
  mode: LinkedinConversationMode, inScope: (request: LinkedinRequest) => boolean) {
  const requests = new Map<string, LinkedinRequest>();
  for (const request of [...archive.map(row => JSON.parse(row.payload) as LinkedinRequest), ...current]) {
    if (isInvitation(request) && inScope(request)) requests.set(linkedinConversationId(request), request);
  }
  const dateField = mode === 'sent' ? 'dateSent' : 'acceptedAt';
  return [...requests.values()].sort((left, right) => (right[dateField] || '').localeCompare(left[dateField] || '') ||
    left.$id.localeCompare(right.$id) || linkedinConversationId(left).localeCompare(linkedinConversationId(right)));
}

export async function readLinkedinInvitations(databases: Databases,
  { start, end, mode }: { start: string; end: string; mode: LinkedinConversationMode }, scope: string[],
  inScope: (request: LinkedinRequest) => boolean) {
  const from = linkedinRequestDateBounds(start).start;
  const until = linkedinRequestDateBounds(end).endExclusive;
  const queries = mode === 'sent' ? [Query.greaterThanEqual('dateSent', from), Query.lessThan('dateSent', until)] : [
    Query.greaterThanEqual('acceptedAt', easternWallTimeToIso(`${start}T00:00`)),
    Query.lessThan('acceptedAt', easternWallTimeToIso(`${until.slice(0, 10)}T00:00`)),
  ];
  const options = { databases, databaseId: DATABASE_ID, requireComplete: true };
  const scoped = [...queries, ...scope, Query.orderAsc('$id')];
  // A resend archives the old attempt before replacing the live pointer.
  // Read live requests first so a concurrent resend cannot fall between scans.
  const current = await listAllDocuments<LinkedinRequest>({ ...options, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [...scoped, Query.select(requestFields)] });
  const archive = await listAllDocuments<LinkedinConversationRecord>({ ...options, collectionId: COLLECTIONS.LINKEDIN_CONVERSATIONS,
    queries: [Query.equal('kind', 'archive'), ...scoped, Query.select(['$id', 'payload'])] });
  return mergeRequests(current, archive, mode, inScope);
}

export async function readTranscripts(databases: Databases, ids: string[]) {
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

export async function readLabels<T extends { $id: string }>(databases: Databases, collectionId: string, ids: string[], fields: string[]) {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    rows.push(...await listAllDocuments<T>({ databases, databaseId: DATABASE_ID, collectionId,
      queries: [Query.equal('$id', ids.slice(start, start + 100)), Query.select(['$id', ...fields])], requireComplete: true }));
  }
  return new Map(rows.map(row => [row.$id, row]));
}

export async function buildLinkedinConversationExportRows(databases: Databases,
  requests: LinkedinConversationListItem[]): Promise<LinkedinConversationExportRow[]> {
  const [transcripts, accounts] = await Promise.all([
    readTranscripts(databases, requests.map(request => request.id)),
    readLabels<AccountLabel>(databases, COLLECTIONS.LINKEDIN_ACCOUNTS, [...new Set(requests.map(request => request.accountId))], ['idName', 'accountType', 'mainAccountId']),
  ]);
  const missingMainIds = [...new Set([...accounts.values()].flatMap(account =>
    account.accountType === 'sudo' && account.mainAccountId && !accounts.has(account.mainAccountId) ? [account.mainAccountId] : []))];
  const mainAccounts = await readLabels<AccountLabel>(databases, COLLECTIONS.LINKEDIN_ACCOUNTS, missingMainIds, ['idName']);
  return requests.map(request => {
    const account = accounts.get(request.accountId);
    const sudo = account?.accountType === 'sudo';
    const mainAccountId = sudo ? account.mainAccountId ?? '' : account?.$id ?? '';
    return { ...request, ...transcripts.get(request.id)!, accountType: account?.accountType ?? null, mainAccountId,
      mainAccount: accounts.get(mainAccountId)?.idName ?? mainAccounts.get(mainAccountId)?.idName ?? '',
      sudoAccountId: sudo ? account.$id : '', sudoAccount: sudo ? account.idName : '' };
  });
}
