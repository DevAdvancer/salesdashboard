import { unstable_cache, revalidateTag } from 'next/cache';
import { Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { resolveReportingPeriod, type ReportingWindow } from '@/lib/utils/reporting-period';

export const REPORTING_CALENDAR_TAG = 'crm-reporting-calendar';
export type StoredReportingWindow = ReportingWindow & { $id: string };
export async function readReportingWindowsFresh(): Promise<StoredReportingWindow[]> {
  const { databases } = await createAdminClient();
  const rows = await listAllDocuments<StoredReportingWindow>({ databases: databases.uncachedReads,
    databaseId: DATABASE_ID, collectionId: COLLECTIONS.TARGET_MONTH_BOUNDS,
    queries: [Query.select(['$id', 'monthKey', 'leadsFromIso', 'leadsToIso']), Query.orderAsc('$id')],
    pageLimit: 100, maxPages: 12, requireComplete: true });
  return rows.map(({ $id, monthKey, leadsFromIso, leadsToIso }) => ({ $id, monthKey, leadsFromIso, leadsToIso }));
}
// Settings only: native session, activation, department and role decisions are never cached.
export const readReportingWindows = unstable_cache(readReportingWindowsFresh, ['crm-reporting-calendar-v1', DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS],
  { revalidate: 300, tags: [REPORTING_CALENDAR_TAG] });
export async function readCurrentReportingPeriod(now = new Date()) { return resolveReportingPeriod(await readReportingWindows(), now); }
export async function readTargetMonthBound(monthKey: string) { return (await readReportingWindows()).find(window => window.monthKey === monthKey) || null; }
export function invalidateReportingCalendar() { revalidateTag(REPORTING_CALENDAR_TAG, { expire: 0 }); }
