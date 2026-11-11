import type * as SheetJS from 'xlsx';
import type { LinkedinConversationExportRow, LinkedinConversationMessage } from '@/lib/types/linkedin-conversation';
import { formatEasternDateTime } from '@/lib/utils/eastern-date';
import { getLinkedinRequestDateFilterValue } from '@/lib/utils/linkedin-request-dates';

const EXCEL_CELL_LIMIT = 32_767;
const headers = ['Conversation ID', 'Request ID', 'Sender', 'CRM sender ID', 'LinkedIn account type', 'LinkedIn account ID',
  'Main LinkedIn account', 'Main LinkedIn ID', 'Sudo LinkedIn account', 'Sudo LinkedIn ID', 'Company', 'Profile URL',
  'Sent date (ET)', 'Accepted at (ET)', 'Withdrawn at (ET)', 'Status', 'Initial invitation text', 'Conversation'];

function conversationCells(messages: LinkedinConversationMessage[]) {
  const text = messages.map(message => `${message.date} ET · ${message.direction === 'sent' ? 'Sent' : 'Received'}\n${message.text}`).join('\n\n');
  const cells: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + EXCEL_CELL_LIMIT, text.length);
    // Keep the two halves of a Unicode character in the same cell.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    cells.push(text.slice(offset, end));
    offset = end;
  }
  return cells.length ? cells : [''];
}

function uniqueSheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/*?:[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '') || 'Sender';
  let attempt = 1;
  while (true) {
    const suffix = attempt === 1 ? '' : ` (${attempt})`;
    const name = base.slice(0, 31 - suffix.length).replace(/'+$/g, '') + suffix;
    const key = name.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return name;
    }
    attempt++;
  }
}

export function buildLinkedinConversationWorkbook(xlsx: typeof SheetJS, rows: LinkedinConversationExportRow[]) {
  const groups = new Map<string, LinkedinConversationExportRow[]>();
  for (const row of rows) {
    const group = groups.get(row.agentId) ?? [];
    group.push(row);
    groups.set(row.agentId, group);
  }

  const book = xlsx.utils.book_new();
  const used = new Set(['history']);
  for (const group of groups.values()) {
    const name = uniqueSheetName(group[0].agent, used);
    group.sort((left, right) => left.mainAccount.localeCompare(right.mainAccount) || left.mainAccountId.localeCompare(right.mainAccountId) ||
      left.sudoAccount.localeCompare(right.sudoAccount) || left.sudoAccountId.localeCompare(right.sudoAccountId));
    const data = group.map(row => [row.id, row.requestId, row.agent, row.agentId, row.accountType ?? '', row.accountId,
      row.mainAccount, row.mainAccountId, row.sudoAccount, row.sudoAccountId, row.company, row.targetUrl,
      getLinkedinRequestDateFilterValue(row.dateSent), row.acceptedAt ? formatEasternDateTime(row.acceptedAt) : '',
      row.withdrawnAt ? formatEasternDateTime(row.withdrawnAt) : '', row.status, row.initialText,
      ...conversationCells(row.messages)]);
    const extraColumns = data.reduce((count, row) => Math.max(count, row.length - headers.length), 0);
    const sheet = xlsx.utils.aoa_to_sheet([[...headers,
      ...Array.from({ length: extraColumns }, (_, index) => `Conversation continued ${index + 1}`)], ...data]);
    sheet['!cols'] = [38, 38, 24, 38, 23, 38, 24, 38, 24, 38, 25, 55, 18, 23, 23, 14, 65, 75,
      ...Array.from({ length: extraColumns }, () => 75)].map(wch => ({ wch }));
    xlsx.utils.book_append_sheet(book, sheet, name);
  }
  return book;
}
