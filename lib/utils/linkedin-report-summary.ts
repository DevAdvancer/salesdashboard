import type { LinkedinAccount, LinkedinRequest } from "@/lib/types";

export type LinkedinReportRow = {
  agentId: string;
  accountId: string;
  company: string;
  idName: string;
  accountType: string;
  sent: number;
  coldCalls: number;
  accepted: number;
  leadsGenerated: number;
  closures: number;
  notAccepted: number;
  withdrawn: number;
};

export function summarizeLinkedinRequests(
  requests: LinkedinRequest[],
  accounts: Map<string, LinkedinAccount>,
  wonLeadIds: Set<string>,
): LinkedinReportRow[] {
  const rows = new Map<string, LinkedinReportRow>();
  for (const request of requests) {
    if (!request.agentId || !request.accountId) continue;
    const account = accounts.get(request.accountId);
    const key = JSON.stringify([request.agentId, request.accountId]);
    const row = rows.get(key) ?? {
      agentId: request.agentId,
      accountId: request.accountId,
      company: request.company || account?.company || "",
      idName: account?.idName || request.accountId,
      accountType: account?.accountType || "main",
      sent: 0, coldCalls: 0, accepted: 0, leadsGenerated: 0,
      closures: 0, notAccepted: 0, withdrawn: 0,
    };
    row.sent += 1;
    if (request.coldCall) row.coldCalls += 1;
    if (request.status === "accepted") row.accepted += 1;
    else if (request.status === "withdrawn") row.withdrawn += 1;
    else row.notAccepted += 1;
    if (request.leadId) {
      row.leadsGenerated += 1;
      if (wonLeadIds.has(request.leadId)) row.closures += 1;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.company.localeCompare(b.company) || a.idName.localeCompare(b.idName));
}
