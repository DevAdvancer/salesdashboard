export const LINKEDIN_INVITATION_TEXT_LIMIT = 500;
export const LINKEDIN_MESSAGE_TEXT_LIMIT = 8000;

export type LinkedinConversationMode = 'sent' | 'accepted';

export type LinkedinConversation = {
  id: string;
  requestId: string;
  agentId: string;
  accountId: string;
  company: string;
  targetUrl: string;
  dateSent: string;
  acceptedAt: string | null;
  withdrawnAt: string | null;
  status: 'sent' | 'accepted' | 'withdrawn';
  canAppend: boolean;
};

export type LinkedinConversationMessage = {
  id: string;
  direction: 'sent' | 'received';
  date: string;
  text: string;
};
