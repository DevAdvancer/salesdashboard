const fs = require('fs');
let c = fs.readFileSync('lib/services/dashboard-data-service.ts', 'utf8');

const target = `  const branchIds = [...(input.branchIds ?? [])].sort();
      );
      const attempts = visibleLeadIds.length
        ? await loadDashboardAttemptCounts(input.userId, visibleLeadIds)
        : EMPTY_TOP_METRICS;`;

const replacement = `  const branchIds = [...(input.branchIds ?? [])].sort();

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
        : EMPTY_TOP_METRICS;`;

c = c.replace(target, replacement);
fs.writeFileSync('lib/services/dashboard-data-service.ts', c);
console.log("Fixed dashboard-data-service.ts!");
