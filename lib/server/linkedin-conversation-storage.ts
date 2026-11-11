import { createHash } from 'node:crypto';
import { Query, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { LinkedinRequest } from '@/lib/types';
import type { LinkedinConversationMessage } from '@/lib/types/linkedin-conversation';

type RequestSnapshot = Pick<LinkedinRequest, '$id' | 'agentId' | 'accountId' | 'teamLeadId' | 'company' |
  'targetUrl' | 'dateSent' | 'acceptedAt' | 'withdrawnAt' | 'status' | 'isActive' | 'coldCall' | 'conversationId'>;

export type LinkedinConversationRecord = {
  conversationId: string;
  kind: 'invitation' | 'message' | 'archive';
  payload: string;
};

function storageId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 28)}`;
}

export function linkedinConversationId(request: Pick<LinkedinRequest, '$id' | 'conversationId' | 'agentId' | 'accountId' | 'dateSent'>) {
  return request.conversationId || storageId('old', JSON.stringify([request.$id, request.agentId, request.accountId, request.dateSent]));
}

export function linkedinArchiveId(conversationId: string) {
  return storageId('archive', conversationId);
}

export async function stageLinkedinInvitation(databases: Databases, conversationId: string, text: string) {
  await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, conversationId, {
    conversationId, kind: 'invitation', payload: text,
  }, []);
}

export async function saveLinkedinConversationMessage(databases: Databases, conversationId: string, message: LinkedinConversationMessage) {
  const id = storageId('message', `${conversationId}:${message.id}`);
  const payload = JSON.stringify(message);
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, id, {
      conversationId, kind: 'message', payload,
    }, []);
  } catch (error) {
    if ((error as { code?: number }).code !== 409) throw error;
    const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, id);
    if (existing.payload !== payload) throw new Error('This message changed while saving. Refresh and try again.');
  }
}

export async function archiveLinkedinConversation(databases: Databases, request: RequestSnapshot) {
  if (!request.conversationId) return;
  const { $id, conversationId, agentId, accountId, teamLeadId, company, targetUrl, dateSent, acceptedAt, withdrawnAt, status, isActive, coldCall } = request;
  const id = linkedinArchiveId(conversationId);
  const data = {
    conversationId, kind: 'archive', agentId, teamLeadId: teamLeadId || null, dateSent, acceptedAt,
    payload: JSON.stringify({ $id, conversationId, agentId, accountId, teamLeadId, company, targetUrl, dateSent, acceptedAt, withdrawnAt, status, isActive, coldCall } satisfies RequestSnapshot),
  };
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, id, data, []);
  } catch (error) {
    if ((error as { code?: number }).code !== 409) throw error;
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, id, data, []);
  }
}

export function linkedinConversationRecordQueries(ids: string[]) {
  return [Query.equal('conversationId', ids), Query.equal('kind', ['invitation', 'message'])];
}
