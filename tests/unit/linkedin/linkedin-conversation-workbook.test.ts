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

it('keeps each agent or team lead on a separate sheet and exports account names and conversations without internal IDs', () => {
  const workbook = roundTrip([invitation, { ...invitation, agentId: 'second', agent: 'alex smith', id: 'second-attempt' },
    { ...invitation, agentId: 'team-lead', agent: 'Team Lead', id: 'tl-attempt' }]);
  expect(workbook.SheetNames).toEqual(['Alex Smith', 'alex smith (2)', 'Team Lead']);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  expect(rows).toEqual([expect.objectContaining({
    Sender: invitation.agent, 'Main LinkedIn account': 'Main profile', 'Sudo LinkedIn account': 'Sudo profile',
    'Initial invitation text': invitation.initialText, Conversation: '2026-11-03 ET · Received\nClient replied',
  })]);
  const columns = Object.keys(rows[0]);
  expect(columns.indexOf('Conversation')).toBe(columns.indexOf('Initial invitation text') + 1);
  const omitted = ['Conversation ID', 'Request ID', 'CRM sender ID', 'LinkedIn account ID', 'Main LinkedIn ID', 'Sudo LinkedIn ID'];
  for (const sheet of Object.values(workbook.Sheets)) {
    const [headers] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(headers).toHaveLength(12);
    expect(headers.every(header => !omitted.includes(header))).toBe(true);
  }
  expect(XLSX.utils.sheet_to_json(workbook.Sheets['Team Lead'])).toEqual([
    expect.objectContaining({ Sender: 'Team Lead', 'Initial invitation text': invitation.initialText }),
  ]);
});

it('preserves text exceeding one Excel cell', () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({ id: `message-${index}`, direction: 'sent' as const,
    date: '2026-11-03', text: `${index}${'🙂'.repeat(3998)}` }));
  const workbook = roundTrip([{ ...invitation, messages }]);
  const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  expect(row.Conversation.length).toBeLessThanOrEqual(32767);
  expect(row.Conversation + row['Conversation continued 1']).toBe(messages.map(message => `2026-11-03 ET · Sent\n${message.text}`).join('\n\n'));
});
