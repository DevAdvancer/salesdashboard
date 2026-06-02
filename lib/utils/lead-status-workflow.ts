export const LEAD_STATUS_INTERESTED = "Interested";
export const LEAD_STATUS_NOT_INTERESTED = "Not Interested";
export const LEAD_STATUS_PIPELINE = "Pipeline / Follow up";
export const LEAD_STATUS_SIGNED_CLOSURE = "Signed/Closure";
export const LEAD_STATUS_BACKED_OUT = "Backed Out";

export const LEAD_WORKFLOW_STATUSES = [
  LEAD_STATUS_INTERESTED,
  LEAD_STATUS_NOT_INTERESTED,
  LEAD_STATUS_PIPELINE,
  LEAD_STATUS_SIGNED_CLOSURE,
  LEAD_STATUS_BACKED_OUT,
];

const CANONICAL_STATUS_BY_NORMALIZED = new Map<string, string>([
  ["interested", LEAD_STATUS_INTERESTED],
  ["notinterested", LEAD_STATUS_NOT_INTERESTED],
  ["pipeline", LEAD_STATUS_PIPELINE],
  ["pipelinefollowup", LEAD_STATUS_PIPELINE],
  ["signed", LEAD_STATUS_SIGNED_CLOSURE],
  ["signedclosure", LEAD_STATUS_SIGNED_CLOSURE],
  ["backout", LEAD_STATUS_BACKED_OUT],
  ["backedout", LEAD_STATUS_BACKED_OUT],
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

export function getLeadEditAllowedStatuses(currentStatus: unknown) {
  const canonical = canonicalizeLeadStatus(currentStatus);
  const normalized = normalizeLeadStatus(canonical);

  if (normalized === "interested") {
    return [LEAD_STATUS_INTERESTED, LEAD_STATUS_PIPELINE];
  }
  if (normalized === "pipelinefollowup") {
    return [
      LEAD_STATUS_PIPELINE,
      LEAD_STATUS_SIGNED_CLOSURE,
      LEAD_STATUS_BACKED_OUT,
    ];
  }
  if (normalized === "notinterested") return [LEAD_STATUS_NOT_INTERESTED];
  if (normalized === "signedclosure") return [LEAD_STATUS_SIGNED_CLOSURE];
  if (normalized === "backedout") return [LEAD_STATUS_BACKED_OUT];

  return canonical ? [canonical, ...LEAD_WORKFLOW_STATUSES] : LEAD_WORKFLOW_STATUSES;
}

export function isAllowedLeadStatusTransition(
  previousStatus: unknown,
  nextStatus: unknown,
) {
  const previous = normalizeLeadStatus(previousStatus);
  const next = normalizeLeadStatus(nextStatus);
  if (!next || previous === next) return true;

  const allowed = new Set(
    getLeadEditAllowedStatuses(previousStatus).map(normalizeLeadStatus),
  );
  return allowed.has(next);
}
