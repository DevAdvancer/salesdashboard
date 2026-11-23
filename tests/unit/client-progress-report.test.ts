/** @jest-environment node */
import type { Databases } from 'node-appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { getProgressReportClients, getProgressReportSummary, invalidateProgressReportSummary, progressReportCsv } from '@/lib/server/client-progress-report';

const range = { from: '2026-11-01', to: '2026-11-01' };
const events = [
  { $id: 'f3', $createdAt: '2026-11-01T17:00:00.000Z', entryId: 'client-a', authorId: 'author-a', authorName: 'Sam', text: '=formula()' },
  { $id: 'f2', $createdAt: '2026-11-01T16:00:00.000Z', entryId: 'client-a', authorId: 'author-a', authorName: 'Sam', text: 'First update' },
  { $id: 'f1', $createdAt: '2026-11-01T15:00:00.000Z', entryId: 'client-a', authorId: 'author-b', authorName: 'Pat', text: 'Another update' },
];

beforeEach(invalidateProgressReportSummary);

test('counts each client once globally and per author, and reuses metadata on drill-down', async () => {
  const listDocuments = jest.fn(async (_database: string, collection: string, _queries: string[]) => ({
    documents: collection === COLLECTIONS.CLIENT_PROGRESS_EVENTS ? events : [{ $id: 'client-a', candidateName: 'Alex' }],
  }));
  const db = { listDocuments } as unknown as Pick<Databases, 'listDocuments'>;
  expect(await getProgressReportSummary(db, range)).toEqual({ clientCount: 1, feedbackCount: 3, people: [
    { id: 'author-a', name: 'Sam', clientCount: 1, feedbackCount: 2 },
    { id: 'author-b', name: 'Pat', clientCount: 1, feedbackCount: 1 },
  ] });
  const queries = listDocuments.mock.calls[0][2].map(query => JSON.parse(query));
  expect(queries).toEqual(expect.arrayContaining([
    { method: 'equal', attribute: 'kind', values: ['feedback'] },
    { method: 'greaterThanEqual', attribute: '$createdAt', values: ['2026-11-01T04:00:00.000Z'] },
    { method: 'lessThanEqual', attribute: '$createdAt', values: ['2026-11-02T04:59:59.999Z'] },
    { method: 'select', values: ['$id', 'entryId', 'authorId', 'authorName'] },
  ]));
  expect(await getProgressReportClients(db, range, 'author-a')).toEqual([{ id: 'client-a', name: 'Alex', feedbackCount: 2 }]);
  expect(listDocuments.mock.calls.map(([, collection]) => collection)).toEqual([COLLECTIONS.CLIENT_PROGRESS_EVENTS, COLLECTIONS.CLIENT_PROGRESS]);
});

test('exports each matching feedback entry with spreadsheet-safe text', async () => {
  const db = { listDocuments: jest.fn(async (_database: string, collection: string) => ({
    documents: collection === COLLECTIONS.CLIENT_PROGRESS_EVENTS ? events.slice(0, 2) : [{ $id: 'client-a', candidateName: 'Alex, Jr.' }],
  })) } as unknown as Pick<Databases, 'listDocuments'>;
  const output = [];
  for await (const chunk of progressReportCsv(db, range, 'author-a', 'alex')) output.push(chunk);
  expect(output.join('')).toContain(`"Alex, Jr.","Sam","Nov 01, 2026, 12:00 PM","'=formula()"`);
  expect(output.join('').match(/"Alex, Jr\."/g)).toHaveLength(2);
});
