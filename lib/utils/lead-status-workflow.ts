export const LEAD_STATUS_INTERESTED = "Interested";
export const LEAD_STATUS_NOT_INTERESTED = "Not Interested";
export const LEAD_STATUS_PIPELINE = "Pipeline / Follow up";
export const LEAD_STATUS_SIGNED_CLOSURE = "Signed/Closure";
export const LEAD_STATUS_BACKED_OUT = "Backed Out";
export const LEAD_STATUS_LINKEDIN = "LinkedIn";
export const LEAD_STATUS_LEADS = "Leads";

// Monitor-only statuses. These are NOT part of the standard workflow and
// are only exposed to users with the `monitor` role. Operations and the
// regular agent/team_lead workflow must never see or transition to these.
export const MONITOR_ONLY_STATUSES = [
  LEAD_STATUS_LINKEDIN,
  LEAD_STATUS_LEADS,
] as const;

export const LEAD_STATUS_CONNECTION_ACCEPTED = "Connection Accepted";

export const LEAD_WORKFLOW_STATUSES = [
  LEAD_STATUS_INTERESTED,
  LEAD_STATUS_NOT_INTERESTED,
  LEAD_STATUS_PIPELINE,
  LEAD_STATUS_BACKED_OUT,
];

export const LINKEDIN_SOURCE_STATUS = "LinkedIN/Lead";

const CANONICAL_STATUS_BY_NORMALIZED = new Map<string, string>([
  ["connectionaccepted", LEAD_STATUS_CONNECTION_ACCEPTED],
  ["interested", LEAD_STATUS_INTERESTED],
  ["notinterested", LEAD_STATUS_NOT_INTERESTED],
  ["pipeline", LEAD_STATUS_PIPELINE],
  ["pipelinefollowup", LEAD_STATUS_PIPELINE],
  ["signed", LEAD_STATUS_SIGNED_CLOSURE],
  ["signedclosure", LEAD_STATUS_SIGNED_CLOSURE],
  ["backout", LEAD_STATUS_BACKED_OUT],
  ["backedout", LEAD_STATUS_BACKED_OUT],
  ["linkedin", LEAD_STATUS_LINKEDIN],
  ["leads", LEAD_STATUS_LEADS],
]);

export function normalizeLeadStatus(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text.replace(/[^a-z0-9]/g, "");
}

export function canonicalizeLeadStatus(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return CANONICAL_STATUS_BY_NORMALIZED.get(normalizeLeadStatus(text)) ?? text;
}

export function getLeadCreateStatusOptions() {
  return [LEAD_STATUS_INTERESTED, LEAD_STATUS_NOT_INTERESTED];
}

export function getLinkedInInitialStatus() {
  return LEAD_STATUS_CONNECTION_ACCEPTED;
}

export function getLeadEditAllowedStatuses(currentStatus: unknown) {
  return getLeadEditAllowedStatusesForRole(currentStatus);
}

export function getLeadEditAllowedStatusesForRole(
  currentStatus: unknown,
  role?: string,
) {
  const canonical = canonicalizeLeadStatus(currentStatus);
  const normalized = normalizeLeadStatus(canonical);
  const includeMonitorOnly = role === "monitor";

  // Monitor-only statuses are never reachable through the standard
  // workflow transitions — they are only allowed as a self-loop (no
  // previous status) or as a one-way hop into LinkedIn/Leads from any
  // status. We handle them after the workflow branches so the existing
  // rules for non-monitor roles are unaffected.
  const monitorOnlySuffix = includeMonitorOnly
    ? [...MONITOR_ONLY_STATUSES]
    : [];

  // Connection Accepted can only transition to Interested or Not Interested
  if (normalized === "connectionaccepted") {
    return [
      LEAD_STATUS_INTERESTED,
      LEAD_STATUS_NOT_INTERESTED,
      ...monitorOnlySuffix,
    ];
  }
  if (normalized === "interested") {
    return [
      LEAD_STATUS_INTERESTED,
      LEAD_STATUS_PIPELINE,
      ...monitorOnlySuffix,
    ];
  }
  if (normalized === "pipelinefollowup") {
    return [
      LEAD_STATUS_PIPELINE,
      LEAD_STATUS_BACKED_OUT,
      ...monitorOnlySuffix,
    ];
  }
  if (normalized === "notinterested") {
    return [LEAD_STATUS_NOT_INTERESTED, ...monitorOnlySuffix];
  }
  if (normalized === "signedclosure") {
    return [...LEAD_WORKFLOW_STATUSES, ...monitorOnlySuffix];
  }
  if (normalized === "backedout") {
    return [LEAD_STATUS_BACKED_OUT, ...monitorOnlySuffix];
  }

  // LinkedIn / Leads are themselves monitor-only statuses. From either of
  // those we can stay in place, return to the standard workflow, or move
  // to the other monitor-only status.
  if (normalized === "linkedin") {
    return includeMonitorOnly
      ? [LEAD_STATUS_LINKEDIN, LEAD_STATUS_LEADS, ...LEAD_WORKFLOW_STATUSES]
      : [LEAD_STATUS_LINKEDIN];
  }
  if (normalized === "leads") {
    return includeMonitorOnly
      ? [LEAD_STATUS_LEADS, LEAD_STATUS_LINKEDIN, ...LEAD_WORKFLOW_STATUSES]
      : [LEAD_STATUS_LEADS];
  }

  return canonical && canonical !== LEAD_STATUS_SIGNED_CLOSURE
    ? [canonical, ...LEAD_WORKFLOW_STATUSES, ...monitorOnlySuffix]
    : [...LEAD_WORKFLOW_STATUSES, ...monitorOnlySuffix];
}

export function isAllowedLeadStatusTransition(
  previousStatus: unknown,
  nextStatus: unknown,
  role?: string,
) {
  const previous = normalizeLeadStatus(previousStatus);
  const next = normalizeLeadStatus(nextStatus);
  if (!next || previous === next) return true;

  // Hard guard: monitor-only statuses are never reachable from a non-monitor
  // user. This protects the server-side transition check from being bypassed
  // by a tampered request.
  const isMonitorOnlyNext =
    next === "linkedin" || next === "leads";
  if (isMonitorOnlyNext && role !== "monitor") {
    return false;
  }

  const allowed = new Set(
    getLeadEditAllowedStatusesForRole(previousStatus, role).map(
      normalizeLeadStatus,
    ),
  );
  return allowed.has(next);
}

export function shouldRequireLeadFollowUpForStatus(
  previousStatus: unknown,
  nextStatus: unknown,
) {
  const previous = normalizeLeadStatus(previousStatus);
  const next = normalizeLeadStatus(nextStatus);
  return next === "pipelinefollowup" && previous !== next;
}
