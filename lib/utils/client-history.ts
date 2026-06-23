import type { Lead } from "@/lib/types";
import { normalizeLeadStatus } from "@/lib/utils/lead-status-workflow";

export function isClientExcludedStatus(value: unknown): boolean {
  const normalized = normalizeLeadStatus(value);
  return (
    normalized === "backout" ||
    normalized === "backedout" ||
    normalized === "notinterested"
  );
}

export function isVisibleClientLead(
  lead: Pick<Lead, "isClosed" | "status">,
): boolean {
  return lead.isClosed === true && !isClientExcludedStatus(lead.status);
}
