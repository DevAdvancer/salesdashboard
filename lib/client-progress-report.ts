import type { ProgressEvent } from '@/lib/client-progress';

export type ProgressReportRange = { from: string; to: string };
export type ProgressReportCounts = { clientCount: number; feedbackCount: number };
export type ProgressReportPerson = ProgressReportCounts & { id: string; name: string };
export type ProgressReportSummary = ProgressReportCounts & { people: ProgressReportPerson[] };
export type ProgressReportClient = { id: string; name: string; feedbackCount: number };
export type ProgressReportFeedback = {
  entries: Pick<ProgressEvent, '$id' | '$createdAt' | 'text'>[];
  nextCursor: string | null;
};

export type ProgressReportRequest = { range: ProgressReportRange } & (
  | { view: 'summary' }
  | { view: 'person'; authorId: string }
  | { view: 'feedback'; authorId: string; entryId: string; cursor?: string }
  | { view: 'export'; authorId?: string; search?: string }
);

export function matchesProgressReportClient(name: string, search: string) {
  return name.toLowerCase().includes(search.trim().toLowerCase());
}
