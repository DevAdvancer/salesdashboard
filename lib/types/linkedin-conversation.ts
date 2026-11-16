export const LINKEDIN_INVITATION_TEXT_LIMIT = 500;
export const LINKEDIN_MESSAGE_TEXT_LIMIT = 8000;
export const LINKEDIN_CONVERSATION_PAYLOAD_LIMIT = 60_000;

export const LINKEDIN_MESSAGE_KINDS = ['sent', 'received', 'transcript'] as const;
export const LINKEDIN_MESSAGE_LABELS = { sent: 'Sent', received: 'Received', transcript: 'Pasted conversation' };

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
  direction: (typeof LINKEDIN_MESSAGE_KINDS)[number];
  date: string;
  text: string;
};

export type LinkedinConversationListItem = LinkedinConversation & { agent: string };

export type LinkedinConversationExportRow = LinkedinConversationListItem & {
  mainAccountId: string;
  mainAccount: string;
  sudoAccountId: string;
  sudoAccount: string;
  accountType: 'main' | 'sudo' | null;
  initialText: string;
  messages: LinkedinConversationMessage[];
};
