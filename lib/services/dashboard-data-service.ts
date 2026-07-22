"use client";

import { countAssessmentEmailsSentInRange } from "@/app/actions/assessment";
import { listHolidayCalendarAction } from "@/app/actions/holiday-calendar";
import {
  listAllPaymentInsightsAction,
  listClientPaymentSummariesAction,
  listLeadPaidAmountsAction,
  type PaymentInsightRecord,
} from "@/app/actions/client-payments";
import { countInterviewEmailsSentInRange } from "@/app/actions/interview";
import { listLgHandoffsAction } from "@/app/actions/lg-handoffs";
import { countMockEmailsSentInRange } from "@/app/actions/mock";
import { listLeads } from "@/lib/services/lead-action-service";
import { loadLeadTargetProgressAction } from "@/app/actions/lead";
import { listBranches } from "@/lib/services/branch-service";
import { loadLinkedinConnectionKpiAction, type LinkedinConnectionKpiRow } from "@/app/actions/linkedin";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import {
  buildLeadershipDashboardInsights,
  resolveLeadUsersForInsights,
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { buildLeadTargetProgress, type DateRange, type KpiRow } from "@/lib/utils/dashboard-kpi";
import {
  filterClosedLeadsInDateRange,
  splitLeadsByReferral,
  type ReferralSplit,
} from "@/lib/utils/dashboard-referral";
import { isVisibleClientLead } from "@/lib/utils/client-history";
import { expandIsoDateToStart, expandIsoDateToEnd } from "@/lib/utils/iso-date-range";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { Branch, Department, Lead, LgHandoff, User } from "@/lib/types";
import type { HolidayCalendarEntry } from "@/lib/types";
import type { TeamLeadAssignmentSummary } from "@/lib/utils/dashboard-insights";

const DASHBOARD_DATA_SCOPE = "dashboard:data";
const DASHBOARD_DATA_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_TOP_METRICS_SCOPE = "dashboard:topMetrics";
const DASHBOARD_LEAD_TARGET_SCOPE = "dashboard:leadTarget";
const DASHBOARD_REFERRAL_SCOPE = "dashboard:referral";
const DASHBOARD_LG_HANDOFFS_SCOPE = "dashboard:lgHandoffs";
const DASHBOARD_HOLIDAY_SCOPE = "dashboard:holidays";

export type AssignedDashboardAgent = User & {
  branchNames: string;
};

export interface DashboardDataInput {
  user: User;
  isAdminLike: boolean;
  isTeamLead: boolean;
  teamLeadId?: string;
  includeAllBranchesForAdminLike?: boolean;
  includeAssignedAgents?: boolean;
  departmentScope?: Department | 'all';
}

export interface DashboardDataResult {
  activeLeads: Lead[];
  closedLeads: Lead[];
  visibleLeadIds: string[];
  insights: LeadershipDashboardInsights;
  assignedAgents: AssignedDashboardAgent[];
}

export interface DashboardAttemptCounts {
  createdMocks: number;
  createdInterviewSupport: number;
  createdAssessmentSupport: number;
}

function makeBranchNameMap(branches: Branch[]) {
  return new Map(branches.map((branch) => [branch.$id, branch.name] as const));
}

function mapAgentsWithBranches(
  agents: User[],
  branchNameById: Map<string, string>,
): AssignedDashboardAgent[] {
  return agents.map((agent) => {
    if (!agent.branchIds || agent.branchIds.length === 0) {
      return { ...agent, branchNames: "N/A" };
    }

    const names = agent.branchIds
      .map((branchId) => branchNameById.get(branchId))
      .filter((branchName): branchName is string => Boolean(branchName));

    return {
      ...agent,
      branchNames: names.length > 0 ? names.join(", ") : "Unknown",
    };
  });
}

export function clearDashboardDataCache(): void {
  clearClientReadCache(DASHBOARD_DATA_SCOPE);
  clearClientReadCache(DASHBOARD_TOP_METRICS_SCOPE);
  clearClientReadCache(DASHBOARD_LEAD_TARGET_SCOPE);
  clearClientReadCache(DASHBOARD_REFERRAL_SCOPE);
  clearClientReadCache(DASHBOARD_LG_HANDOFFS_SCOPE);
  clearClientReadCache("dashboard:linkedinConnectionKpi");
  clearClientReadCache(DASHBOARD_HOLIDAY_SCOPE);
}

import { loadDashboardDataServerAction } from "@/app/actions/dashboard";

export async function loadDashboardData(
  input: DashboardDataInput,
): Promise<DashboardDataResult> {
  const branchIds = input.user.branchIds ?? [];
  const normalizedBranchIds = [...branchIds].sort();
  const normalizedTeamLeadId = input.teamLeadId ?? null;

  return cacheClientRead(
    DASHBOARD_DATA_SCOPE,
    [
      input.user.$id,
      input.user.role,
      normalizedBranchIds,
      input.isAdminLike,
      input.isTeamLead,
      normalizedTeamLeadId,
      Boolean(input.includeAllBranchesForAdminLike),
      Boolean(input.includeAssignedAgents),
      input.departmentScope ?? 'all',
    ],
    async () => {
      // Delegate to the Server Action to prevent fetching massive JSON arrays over the network to the browser
      return loadDashboardDataServerAction(input);
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

/**
 * Support-email counts for the dashboard tiles ("Created Mocks / Interview /
 * Assessment"). Counts each email SENT within [dateFromIso, dateToIso],
 * scoped to the leads the caller can see. Unlike the leads/clients tiles —
 * which count leads *created* in the range — a support email is counted by
 * its own send date, so an email sent this month against a lead created last
 * month still shows up. This is what makes the tile match the actual number
 * of emails sent in the period.
 */
export async function loadDashboardAttemptCounts(
  userId: string,
  role: User["role"],
  branchIds: string[] | undefined,
  dateFromIso: string,
  dateToIso: string,
): Promise<DashboardAttemptCounts> {
  if (!dateFromIso || !dateToIso) {
    return {
      createdMocks: 0,
      createdInterviewSupport: 0,
      createdAssessmentSupport: 0,
    };
  }

  return cacheClientRead(
    `${DASHBOARD_DATA_SCOPE}:attemptCounts`,
    [userId, role, [...(branchIds ?? [])].sort(), dateFromIso, dateToIso],
    async () => {
      const safeBranchIds = branchIds ?? [];
      const [createdMocks, createdInterviewSupport, createdAssessmentSupport] =
        await Promise.all([
          countMockEmailsSentInRange(userId, role, safeBranchIds, dateFromIso, dateToIso),
          countInterviewEmailsSentInRange(userId, role, safeBranchIds, dateFromIso, dateToIso),
          countAssessmentEmailsSentInRange(userId, role, safeBranchIds, dateFromIso, dateToIso),
        ]);

      return {
        createdMocks,
        createdInterviewSupport,
        createdAssessmentSupport,
      };
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

export async function loadDashboardPaymentInsights(
  actorId: string,
  dateRange: DateRange,
): Promise<PaymentInsightRecord[]> {
  return cacheClientRead(
    `${DASHBOARD_DATA_SCOPE}:paymentInsights`,
    [actorId, dateRange.from ?? "", dateRange.to ?? ""],
    () => listAllPaymentInsightsAction(actorId, dateRange.from, dateRange.to),
    DASHBOARD_DATA_TTL_MS,
  );
}

export async function loadDashboardHolidayCalendar(
  actorId: string,
): Promise<HolidayCalendarEntry[]> {
  return cacheClientRead(
    DASHBOARD_HOLIDAY_SCOPE,
    [actorId],
    () => listHolidayCalendarAction({ currentUserId: actorId }),
    DASHBOARD_DATA_TTL_MS,
  );
}

// ----------------------------------------------------------------------------
// New dashboard sections (top row + KPI + referral split). These replace the
// monolithic `loadDashboardData` for the new dashboard page, but the legacy
// function is kept because `app/work-queue/page.tsx` still depends on it.
// ----------------------------------------------------------------------------

export interface TopMetrics {
  activeLeads: number;
  closedLeads: number;
  createdMocks: number;
  createdInterviewSupport: number;
  createdAssessmentSupport: number;
}

export interface TopMetricsInput {
  userId: string;
  role: User["role"];
  branchIds?: string[];
  dateRange: DateRange;
}

const EMPTY_TOP_METRICS: TopMetrics = {
  activeLeads: 0,
  closedLeads: 0,
  createdMocks: 0,
  createdInterviewSupport: 0,
  createdAssessmentSupport: 0,
};

/**
 * Top-row metrics (Active / Clients / Mocks / Interview / Assessment).
 * All five respect the date range — leads created inside the window and
 * attempts against those leads. Falls back to today when no range is set.
 */
export async function loadDashboardTopMetrics(
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
      // 1. Active (created in range) + closed (closed in range) counts. These
      //    two tiles are date-of-lead based and stay unchanged.
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

      // 2. Support-email counts are based on their own send timestamp against the
      //    range, then they check which leads the user is allowed to see.
      const dateFromIso = expandIsoDateToStart(dateFrom ?? "");
      const dateToIso = expandIsoDateToEnd(dateTo ?? "");
      const attempts = await loadDashboardAttemptCounts(
          input.userId,
          input.role,
          input.branchIds,
          dateFromIso,
          dateToIso,
      );

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
}

export interface LeadTargetInput {
  userId: string;
  role: User["role"];
  teamLeadId?: string;
  branchIds?: string[];
  dateRange: DateRange;
}

/**
 * Returns per-user lead count progress for the KPI section.
 * - Admin-like (no teamLeadId): every active user.
 * - Admin-like with teamLeadId: just that TL + their agents.
 * - Team lead: self + their agents.
 * - Agent: self only.
 * - Lead generation: self only.
 */
export async function loadLeadTargetProgress(
  input: LeadTargetInput,
): Promise<KpiRow[]> {
  const branchIds = [...(input.branchIds ?? [])].sort();

  return cacheClientRead(
    DASHBOARD_LEAD_TARGET_SCOPE,
    [
      input.userId,
      input.role,
      input.teamLeadId ?? null,
      branchIds,
      input.dateRange.from ?? "",
      input.dateRange.to ?? "",
    ],
    async () => {
      return loadLeadTargetProgressAction({
        userId: input.userId,
        role: input.role,
        teamLeadId: input.teamLeadId,
        branchIds: input.branchIds,
        dateRange: input.dateRange,
      });
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

export interface LinkedinConnectionKpiInput {
  userId: string;
  role: User["role"];
  teamLeadId?: string;
  branchIds?: string[];
  dateRange: DateRange;
}

export async function loadLinkedinConnectionKpiProgress(
  input: LinkedinConnectionKpiInput,
): Promise<LinkedinConnectionKpiRow[]> {
  const branchIds = [...(input.branchIds ?? [])].sort();

  return cacheClientRead(
    "dashboard:linkedinConnectionKpi",
    [
      input.userId,
      input.role,
      input.teamLeadId ?? null,
      branchIds,
      input.dateRange.from ?? "",
      input.dateRange.to ?? "",
    ],
    async () => {
      return loadLinkedinConnectionKpiAction({
        userId: input.userId,
        role: input.role,
        teamLeadId: input.teamLeadId,
        branchIds: input.branchIds,
        dateRange: input.dateRange,
      });
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

async function resolveScopeUsers(input: {
  userId: string;
  role: User["role"];
  teamLeadId?: string;
  branchIds?: string[];
}): Promise<User[]> {
  const { userId, role, teamLeadId, branchIds } = input;

  // KPI scope: active sales-dept agents AND team leads appear in the
  // dashboard lead-target. Other roles (admin, developer, monitor,
  // operations, lead_generation, resume-dept) are excluded — they have
  // different workflows and shouldn't be measured against the lead
  // target.
  const isKpiEligible = (user: User | null | undefined): user is User =>
    Boolean(
      user &&
      user.isActive !== false &&
      user.department === "sales" &&
      (user.role === "agent" || user.role === "team_lead"),
    );

  if (role === "agent" || role === "lead_generation") {
    const self = await getUserByIdOrNull(userId);
    return isKpiEligible(self) ? [self] : [];
  }

  if (role === "team_lead") {
    // KPI shows this TL plus the agents assigned to them.
    const self = await getUserByIdOrNull(userId);
    const agents = await getAgentsByTeamLead(userId);
    return [self, ...agents].filter(isKpiEligible);
  }

  // admin / developer / monitor / operations
  if (teamLeadId) {
    // KPI shows the selected TL plus their agents.
    const selected = await getUserByIdOrNull(teamLeadId);
    const agents = await getAgentsByTeamLead(teamLeadId);
    return [selected, ...agents].filter(isKpiEligible);
  }

  const all = await getAssignableUsers(role, branchIds ?? [], userId, "all");
  const filtered = all.filter(
    (candidate) =>
      candidate.$id !== userId &&
      isKpiEligible(candidate) &&
      // Exclude agents without a team lead (unassigned agents)
      !(candidate.role === "agent" && !candidate.teamLeadId),
  );
  return filtered;
}

export interface ReferralStatsInput {
  userId: string;
  role: User["role"];
  branchIds?: string[];
  monthStartIso: string;
  monthEndIso: string;
}

export async function loadDashboardReferralStats(
  input: ReferralStatsInput,
): Promise<ReferralSplit> {
  return cacheClientRead(
    DASHBOARD_REFERRAL_SCOPE,
    [
      input.userId,
      input.role,
      ...(input.branchIds ?? []).sort(),
      input.monthStartIso,
      input.monthEndIso,
    ],
    async () => {
      // The referral split is a "closed this month" view. Pull closed leads
      // in scope, then filter by `closedAt` instead of `$createdAt` so leads
      // created earlier but closed this month are counted correctly.
      const closedLeads = await listLeads(
        {
          isClosed: true,
          closedAtFrom: input.monthStartIso,
          closedAtTo: input.monthEndIso,
        },
        input.userId,
        input.role,
        input.branchIds,
      );
      const leads = filterClosedLeadsInDateRange(
        closedLeads,
        input.monthStartIso,
        input.monthEndIso,
      );
      // Build a leadId → total-paid lookup from actual payment records so
      // the referral / non-referral totals reflect money actually
      // collected, not the planned leadAmount from the lead form.
      const leadIds = leads.map((l) => l.$id);
      const paidRecord = leadIds.length > 0
        ? await listLeadPaidAmountsAction({ actorId: input.userId, leadIds })
        : {};
      const paidMap = new Map<string, number>(Object.entries(paidRecord));
      const paymentSummaries = leadIds.length > 0
        ? await listClientPaymentSummariesAction({
            actorId: input.userId,
            leadIds,
          })
        : [];
      const upfrontMap = new Map<string, number>(
        paymentSummaries.map((summary) => [
          summary.leadId,
          Number.isFinite(summary.paymentPlan?.upfrontAmount)
            ? summary.paymentPlan.upfrontAmount
            : 0,
        ]),
      );
      const statusMap = new Map<string, string>(
        paymentSummaries.map((summary) => [summary.leadId, summary.status]),
      );
      return splitLeadsByReferral(leads, paidMap, upfrontMap, statusMap);
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

/**
 * Fetches all lg_handoffs rows and builds per-TL summaries (handoff count
 * + per-LG-actor breakdown) for the admin dashboard "Lead Gen Handoffs" card.
 *
 * Uses the same TTL cache as the other dashboard sections. If the collection
 * is missing, returns an empty array so the card renders an empty state.
 */
export async function loadLgHandoffSummaries(
  actorId: string,
): Promise<TeamLeadAssignmentSummary[]> {
  return cacheClientRead(
    DASHBOARD_LG_HANDOFFS_SCOPE,
    [actorId],
    async () => {
      // 1. Fetch all handoff rows.
      const handoffs: LgHandoff[] = await listLgHandoffsAction().catch(() => []);
      if (handoffs.length === 0) return [];

      // 2. Collect unique user IDs referenced in the handoff rows.
      const tlIds = new Set<string>();
      const lgIds = new Set<string>();
      for (const h of handoffs) {
        if (h.teamLeadId) tlIds.add(h.teamLeadId);
        if (h.leadGenerationId) lgIds.add(h.leadGenerationId);
      }

      // 3. Resolve user names in parallel.
      const resolveAll = async (ids: Set<string>): Promise<Map<string, string>> => {
        const entries = await Promise.all(
          Array.from(ids).map(async (id) => {
            const u = await getUserByIdOrNull(id).catch(() => null);
            return [id, u?.name ?? "Unknown"] as [string, string];
          }),
        );
        return new Map(entries);
      };

      const [tlNames, lgNames] = await Promise.all([
        resolveAll(tlIds),
        resolveAll(lgIds),
      ]);

      // 4. Aggregate per-TL.
      const summaryMap = new Map<string, TeamLeadAssignmentSummary>();
      for (const h of handoffs) {
        const tlId = h.teamLeadId;
        const lgId = h.leadGenerationId;
        if (!tlId || !lgId) continue;

        const existing = summaryMap.get(tlId) ?? {
          teamLeadId: tlId,
          teamLeadName: tlNames.get(tlId) ?? "Unknown",
          assignedLeads: 0,
          assignmentShare: 0,
          leadGenerationBreakdown: [],
        };
        existing.assignedLeads += 1;

        const lgEntry = existing.leadGenerationBreakdown.find(
          (e) => e.leadGenerationId === lgId,
        );
        if (lgEntry) {
          lgEntry.assignedLeads += 1;
        } else {
          existing.leadGenerationBreakdown.push({
            leadGenerationId: lgId,
            leadGenerationName: lgNames.get(lgId) ?? "Unknown",
            assignedLeads: 1,
          });
        }
        summaryMap.set(tlId, existing);
      }

      // 5. Compute shares and sort.
      const total = Array.from(summaryMap.values()).reduce(
        (s, t) => s + t.assignedLeads,
        0,
      );
      return Array.from(summaryMap.values())
        .map((t) => ({
          ...t,
          assignmentShare: total > 0 ? Math.round((t.assignedLeads / total) * 100) : 0,
          leadGenerationBreakdown: [...t.leadGenerationBreakdown].sort(
            (a, b) =>
              b.assignedLeads - a.assignedLeads ||
              a.leadGenerationName.localeCompare(b.leadGenerationName),
          ),
        }))
        .sort(
          (a, b) =>
            b.assignedLeads - a.assignedLeads ||
            a.teamLeadName.localeCompare(b.teamLeadName),
        );
    },
    DASHBOARD_DATA_TTL_MS,
  );
}
