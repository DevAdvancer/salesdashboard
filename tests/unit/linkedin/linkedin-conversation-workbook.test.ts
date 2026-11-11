import * as XLSX from 'xlsx';
import { buildLinkedinConversationWorkbook } from '@/lib/utils/linkedin-conversation-workbook';
import type { LinkedinConversationExportRow } from '@/lib/types/linkedin-conversation';

const invitation: LinkedinConversationExportRow = {
  id: 'attempt', requestId: 'request', agent: 'Alex / Smith', agentId: 'first', accountType: 'sudo',
  accountId: 'sudo-id', mainAccount: 'Main profile', mainAccountId: 'main-id', sudoAccount: 'Sudo profile', sudoAccountId: 'sudo-id',
  company: 'Company', targetUrl: 'https://www.linkedin.com/in/example', dateSent: '2026-11-01T00:00:00.000Z',
  acceptedAt: '2026-11-02T16:00:00.000Z', withdrawnAt: null, status: 'accepted', canAppend: false,
  initialText: '=Initial invitation as plain text', messages: [{ id: 'message', direction: 'received', date: '2026-11-03', text: 'Client replied' }],
};

function roundTrip(rows: LinkedinConversationExportRow[]) {
  return XLSX.read(XLSX.write(buildLinkedinConversationWorkbook(XLSX, rows), { type: 'buffer', bookType: 'xlsx' }));
}

it('keeps distinct senders on separate sheets and puts both account IDs and the conversation on the invitation row', () => {
  const workbook = roundTrip([invitation, { ...invitation, agentId: 'second', agent: 'alex smith', id: 'second-attempt' }]);
  expect(workbook.SheetNames).toEqual(['Alex Smith', 'alex smith (2)']);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  expect(rows).toEqual([expect.objectContaining({
    'CRM sender ID': 'first', 'Main LinkedIn ID': 'main-id', 'Sudo LinkedIn ID': 'sudo-id',
    'Initial invitation text': invitation.initialText, Conversation: '2026-11-03 ET · Received\nClient replied',
  })]);
  const columns = Object.keys(rows[0]);
  expect(columns.indexOf('Conversation')).toBe(columns.indexOf('Initial invitation text') + 1);
});

it('preserves text exceeding one Excel cell', () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({ id: `message-${index}`, direction: 'sent' as const,
    date: '2026-11-03', text: `${index}${'🙂'.repeat(3998)}` }));
  const workbook = roundTrip([{ ...invitation, messages }]);
  const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  expect(row.Conversation.length).toBeLessThanOrEqual(32767);
  expect(row.Conversation + row['Conversation continued 1']).toBe(messages.map(message => `2026-11-03 ET · Sent\n${message.text}`).join('\n\n'));
});
