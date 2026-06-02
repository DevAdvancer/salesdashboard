import { getWeeklyReportAction } from "@/app/actions/weekly-report";
import { cacheClientRead } from "@/lib/utils/client-read-cache";

const WEEKLY_REPORT_TTL_MS = 30 * 1000;

export function getWeeklyReport(actorId: string, from: string, to: string) {
  return cacheClientRead(
    "reports:weekly",
    [actorId, from, to],
    () => getWeeklyReportAction({ actorId, from, to }),
    WEEKLY_REPORT_TTL_MS,
  );
}

