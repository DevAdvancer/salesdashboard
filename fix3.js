const fs = require('fs');
let lines = fs.readFileSync('lib/services/dashboard-data-service.ts', 'utf8').split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('export async function loadDashboardTopMetrics('));
const endIdx = lines.findIndex((l, i) => i > startIdx && l === '}');

if (startIdx !== -1 && endIdx !== -1) {
  const newLines = `export async function loadDashboardTopMetrics(
  input: TopMetricsInput,
): Promise<TopMetrics> {
  const dateFrom = input.dateRange.from;
  const dateTo = input.dateRange.to;
  if (!dateFrom && !dateTo) {
    return EMPTY_TOP_METRICS;
  }

  const branchIds = [...(input.branchIds ?? [])].sort();

  return cacheClientRead(
    DASHBOARD_TOP_METRICS_SCOPE,
    [input.userId, input.role, branchIds, dateFrom ?? "", dateTo ?? ""],
    async () => {
      // 1. Active + closed counts in the range.
      const [active, closed] = await Promise.all([
        listLeads(
          { isClosed: false, dateFrom, dateTo },
          input.userId,
          input.role,
          input.branchIds,
        ),
        listLeads(
          { isClosed: true, closedAtFrom: dateFrom, closedAtTo: dateTo },
          input.userId,
          input.role,
          input.branchIds,
        ),
      ]);
      const closedInRange = filterClosedLeadsInDateRange(
        closed,
        dateFrom ?? "",
        dateTo ?? "",
      ).filter(isVisibleClientLead);

      // 2. Attempt counts against the visible lead IDs.
      const visibleLeadIds = Array.from(
        new Set([...active, ...closedInRange].map((lead) => lead.$id)),
      );
      const attempts = visibleLeadIds.length
        ? await loadDashboardAttemptCounts(input.userId, visibleLeadIds)
        : EMPTY_TOP_METRICS;

      return {
        activeLeads: active.length,
        closedLeads: closedInRange.length,
        createdMocks: attempts.createdMocks,
        createdInterviewSupport: attempts.createdInterviewSupport,
        createdAssessmentSupport: attempts.createdAssessmentSupport,
      };
    },
    DASHBOARD_DATA_TTL_MS,
  );
}`.split('\n');

  lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  fs.writeFileSync('lib/services/dashboard-data-service.ts', lines.join('\n'));
  console.log("Success!");
} else {
  console.log("Could not find function bounds.");
}
