import { Query, type Databases, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { ProgressEvent } from '@/lib/client-progress';
import { matchesProgressReportClient, type ProgressReportClient, type ProgressReportFeedback, type ProgressReportRange, type ProgressReportSummary } from '@/lib/client-progress-report';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { formatEasternDateTime } from '@/lib/utils/eastern-date';
import { easternDayBounds } from '@/lib/utils/reporting-period';

type FeedbackMetadata = Pick<ProgressEvent, 'entryId' | 'authorId' | 'authorName'>;
type Person = { name: string; feedbackCount: number; clients: Map<string, number> };
type ReportTotals = { summary: ProgressReportSummary; people: Map<string, Person> };
type ReportReads = Pick<Databases, 'listDocuments'>;

const metadataSelect = Query.select(['$id', 'entryId', 'authorId', 'authorName']);
const feedbackOrder = [Query.orderDesc('$createdAt'), Query.orderDesc('$id')];
const summaryCache = new Map<string, { expiresAt: number; totals: Promise<ReportTotals> }>();
const summaryTtlMs = 30_000;
const maxCachedRanges = 16;
const feedbackPageSize = 20;
const nameBatchSize = 100;

export function invalidateProgressReportSummary() {
  summaryCache.clear();
}

function feedbackQueries(range: ProgressReportRange, authorId?: string, entryId?: string) {
  const { from, to } = easternDayBounds(range.from, range.to);
  const queries = [Query.equal('kind', 'feedback'), Query.greaterThanEqual('$createdAt', from), Query.lessThanEqual('$createdAt', to)];
  if (authorId) queries.push(Query.equal('authorId', authorId));
  if (entryId) queries.push(Query.equal('entryId', entryId));
  return queries;
}

function readMetadata(db: ReportReads, range: ProgressReportRange, authorId?: string) {
  return listAllDocuments<FeedbackMetadata>({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PROGRESS_EVENTS,
    queries: [...feedbackQueries(range, authorId), metadataSelect, ...feedbackOrder], pageLimit: 1000, maxPages: 500, requireComplete: true });
}

function groupFeedback(events: FeedbackMetadata[]) {
  const people = new Map<string, Person>();
  const clients = new Set<string>();
  for (const event of events) {
    let person = people.get(event.authorId);
    if (!person) {
      person = { name: event.authorName || 'Unknown author', feedbackCount: 0, clients: new Map() };
      people.set(event.authorId, person);
    }
    person.feedbackCount++;
    person.clients.set(event.entryId, (person.clients.get(event.entryId) ?? 0) + 1);
    clients.add(event.entryId);
  }
  return {
    people,
    summary: {
      clientCount: clients.size,
      feedbackCount: events.length,
      people: Array.from(people, ([id, person]) => ({ id, name: person.name, clientCount: person.clients.size, feedbackCount: person.feedbackCount }))
        .sort((a, b) => b.clientCount - a.clientCount || b.feedbackCount - a.feedbackCount || a.name.localeCompare(b.name)),
    },
  };
}

function rangeKey(range: ProgressReportRange) {
  return `${range.from}/${range.to}`;
}

function cachedSummary(range: ProgressReportRange) {
  const key = rangeKey(range);
  const cached = summaryCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.totals;
  summaryCache.delete(key);
}

export async function getProgressReportSummary(db: ReportReads, range: ProgressReportRange) {
  const cached = cachedSummary(range);
  if (cached) return (await cached).summary;
  const key = rangeKey(range);
  const totals = readMetadata(db, range).then(groupFeedback);
  if (summaryCache.size >= maxCachedRanges) summaryCache.delete(summaryCache.keys().next().value!);
  const record = { expiresAt: Number.POSITIVE_INFINITY, totals };
  summaryCache.set(key, record);
  try {
    return (await totals).summary;
  } catch (error) {
    if (summaryCache.get(key) === record) summaryCache.delete(key);
    throw error;
  } finally {
    record.expiresAt = Date.now() + summaryTtlMs;
  }
}

// Historical feedback still counts when a client later leaves the active list.
async function loadClientNames(db: ReportReads, ids: string[], names = new Map<string, string>()) {
  const missing = ids.filter(id => !names.has(id));
  for (let start = 0; start < missing.length; start += nameBatchSize) {
    const batch = missing.slice(start, start + nameBatchSize);
    const { documents } = await db.listDocuments<Models.Document & { candidateName: string }>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, [
      Query.equal('$id', batch), Query.equal('department', 'sales'), Query.select(['$id', 'candidateName']), Query.limit(batch.length),
    ]);
    for (const id of batch) names.set(id, `Unavailable client (${id})`);
    for (const client of documents) names.set(client.$id, client.candidateName || `Unnamed client (${client.$id})`);
  }
  return names;
}

export async function getProgressReportClients(db: ReportReads, range: ProgressReportRange, authorId: string): Promise<ProgressReportClient[]> {
  const cached = await cachedSummary(range)?.catch(() => undefined);
  // Across server instances or after expiry, scan only the selected person's metadata.
  const person = cached ? cached.people.get(authorId) : groupFeedback(await readMetadata(db, range, authorId)).people.get(authorId);
  if (!person) return [];
  const names = await loadClientNames(db, [...person.clients.keys()]);
  return Array.from(person.clients, ([id, feedbackCount]) => ({ id, name: names.get(id)!, feedbackCount }));
}

export async function getProgressReportFeedback(db: ReportReads, range: ProgressReportRange, authorId: string, entryId: string, cursor?: string): Promise<ProgressReportFeedback> {
  const queries = [...feedbackQueries(range, authorId, entryId), ...feedbackOrder,
    Query.select(['$id', '$createdAt', 'text']), Query.limit(feedbackPageSize + 1)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  const { documents } = await db.listDocuments<Models.Document & ProgressEvent>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, queries);
  const entries = documents.slice(0, feedbackPageSize).map(({ $id, $createdAt, text }) => ({ $id, $createdAt, text }));
  return { entries, nextCursor: documents.length > feedbackPageSize ? entries[feedbackPageSize - 1].$id : null };
}

function csvCell(value: string) {
  // Keep formula-like user input inert when a CSV is opened in a spreadsheet.
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function* progressReportCsv(db: ReportReads, range: ProgressReportRange, authorId?: string, search = '') {
  const names = new Map<string, string>();
  const pageSize = 100;
  const base = [...feedbackQueries(range, authorId), ...feedbackOrder, Query.limit(pageSize),
    Query.select(['$id', '$createdAt', 'entryId', 'authorName', 'text'])];
  let cursor: string | undefined;
  yield '\uFEFFClient,Posted by,Posted at (Eastern),Feedback\r\n';
  for (;;) {
    const queries = cursor ? [...base, Query.cursorAfter(cursor)] : base;
    const { documents } = await db.listDocuments<Models.Document & ProgressEvent>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, queries);
    await loadClientNames(db, [...new Set(documents.map(event => event.entryId))], names);
    const rows = documents.filter(event => matchesProgressReportClient(names.get(event.entryId)!, search))
      .map(event => [names.get(event.entryId)!, event.authorName, formatEasternDateTime(event.$createdAt), event.text].map(csvCell).join(','));
    if (rows.length) yield `${rows.join('\r\n')}\r\n`;
    if (documents.length < pageSize) return;
    cursor = documents.at(-1)!.$id;
  }
}
