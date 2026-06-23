import {
  getTargetReportAction,
} from "@/app/actions/target-report";
import type { TargetReportResult } from "@/lib/utils/monthly-target-report";
import {
  listMonthlyTargetsAction,
  listMonthlyTargetAssignmentsAction,
  listMonthlyTargetsWithAssignmentsAction,
  listTeamLeadsForTargetAction,
  listTeamAgentsForTargetAction,
  upsertMonthlyTeamTargetAction,
  replaceMonthlyTargetAssignmentsAction,
  type AgentOption,
  type TeamLeadOption,
} from "@/app/actions/monthly-targets";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { MonthlyTarget, MonthlyTargetAssignment } from "@/lib/types";

const TARGET_REPORT_SCOPE_PREFIX = "target-report:";
const TARGET_REPORT_TTL_MS = 60 * 1000;

export interface TargetReportPayload {
  result: TargetReportResult;
  monthLabel: string;
}

export function clearTargetReportCache() {
  clearClientReadCache(TARGET_REPORT_SCOPE_PREFIX);
}

export function getTargetReport(input: {
  actorId: string;
  monthKey: string;
}): Promise<TargetReportPayload> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}getTargetReport`,
    [input.actorId, input.monthKey],
    () => getTargetReportAction(input),
    TARGET_REPORT_TTL_MS,
  );
}

export function listMonthlyTargets(input: {
  actorId: string;
  monthKey?: string;
}): Promise<MonthlyTarget[]> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}listTargets`,
    [input.actorId, input.monthKey ?? ""],
    () => listMonthlyTargetsAction(input),
    TARGET_REPORT_TTL_MS,
  );
}

export function listMonthlyTargetAssignments(input: {
  actorId: string;
  monthlyTargetId: string;
}): Promise<MonthlyTargetAssignment[]> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}listAssignments`,
    [input.actorId, input.monthlyTargetId],
    () => listMonthlyTargetAssignmentsAction(input),
    TARGET_REPORT_TTL_MS,
  );
}

export function listMonthlyTargetsWithAssignments(input: {
  actorId: string;
  monthKey: string;
}): Promise<{
  targets: MonthlyTarget[];
  assignmentsByTargetId: Record<string, MonthlyTargetAssignment[]>;
}> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}listTargetsWithAssignments`,
    [input.actorId, input.monthKey],
    () => listMonthlyTargetsWithAssignmentsAction(input),
    TARGET_REPORT_TTL_MS,
  );
}

export function listTeamLeadsForTarget(input: {
  actorId: string;
}): Promise<TeamLeadOption[]> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}listTeamLeads`,
    [input.actorId],
    () => listTeamLeadsForTargetAction(input),
    5 * 60 * 1000,
  );
}

export function listTeamAgentsForTarget(input: {
  actorId: string;
}): Promise<AgentOption[]> {
  return cacheClientRead(
    `${TARGET_REPORT_SCOPE_PREFIX}listTeamAgents`,
    [input.actorId],
    () => listTeamAgentsForTargetAction(input),
    5 * 60 * 1000,
  );
}

export function upsertMonthlyTeamTarget(
  input: Parameters<typeof upsertMonthlyTeamTargetAction>[0],
): Promise<MonthlyTarget> {
  return upsertMonthlyTeamTargetAction(input).finally(() => {
    clearTargetReportCache();
  });
}

export function replaceMonthlyTargetAssignments(
  input: Parameters<typeof replaceMonthlyTargetAssignmentsAction>[0],
): Promise<MonthlyTargetAssignment[]> {
  return replaceMonthlyTargetAssignmentsAction(input).finally(() => {
    clearTargetReportCache();
  });
}
