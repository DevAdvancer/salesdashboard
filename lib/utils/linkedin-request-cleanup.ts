import { normalizeStoredProfileUrl } from "./linkedin-extension-url";

export type LinkedinRequestCleanupRow = {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  company: string;
  targetUrl: string;
  status: string;
  isActive?: boolean;
  leadId?: string | null;
  agentId?: string;
  accountId?: string;
  dateSent?: string;
  acceptedAt?: string | null;
  withdrawnAt?: string | null;
};

const CURRENT_COMPANIES: Record<string, string> = {
  silverspaceinc: "Silverspace INC",
  vizvainc: "Vizva INC",
  flawlessed: "Flawless-ED",
};

export function linkedinCompanyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function statusRank(row: LinkedinRequestCleanupRow): number {
  if (row.status === "accepted" && row.leadId) return 3;
  if (row.status === "accepted") return 2;
  if (row.status === "sent") return 1;
  return 0;
}

export function planLinkedinRequestCleanup(
  rows: LinkedinRequestCleanupRow[],
  leadReferences: Record<string, string[]> = {},
) {
  const groups = new Map<string, LinkedinRequestCleanupRow[]>();
  const profiles = new Map<string, Set<string>>();
  const invalid: Array<{ id: string; url: string }> = [];
  for (const row of rows) {
    try {
      const targetUrl = normalizeStoredProfileUrl(row.targetUrl);
      const companyKey = linkedinCompanyKey(row.company || "");
      if (!companyKey) throw new Error("Missing company");
      const key = JSON.stringify([companyKey, targetUrl]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
      profiles.set(targetUrl, (profiles.get(targetUrl) ?? new Set()).add(companyKey));
    } catch {
      invalid.push({ id: row.$id, url: row.targetUrl });
    }
  }
  const duplicates = [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => {
    const sorted = [...group].sort((left, right) =>
      left.$createdAt.localeCompare(right.$createdAt) || left.$id.localeCompare(right.$id));
    const keeper = sorted[0];
    const remove = sorted.slice(1);
    const winner = [...sorted].sort((left, right) =>
      statusRank(right) - statusRank(left) ||
      (right.dateSent ?? "").localeCompare(left.dateSent ?? "") ||
      right.$updatedAt.localeCompare(left.$updatedAt))[0];
    const linkedLeadIds = [...new Set(sorted.flatMap(row => [
      ...(row.leadId ? [row.leadId] : []), ...(leadReferences[row.$id] ?? []),
    ]))];
    const [companyKey, targetUrl] = JSON.parse(key) as [string, string];
    return {
      key, keeper, remove, winner,
      linkedLeadIds,
      blockedReason: linkedLeadIds.length > 1 ? "Several different leads link to this profile" : null,
      keeperAfter: {
        company: CURRENT_COMPANIES[companyKey] ?? keeper.company.trim(),
        targetUrl,
        status: winner.status,
        isActive: winner.status !== "withdrawn",
        dateSent: winner.status !== "withdrawn" ? winner.dateSent ?? keeper.dateSent : keeper.dateSent,
        acceptedAt: winner.status === "accepted" ? winner.acceptedAt ?? null : null,
        withdrawnAt: winner.status === "withdrawn" ? winner.withdrawnAt ?? keeper.withdrawnAt ?? null : null,
        leadId: linkedLeadIds[0] ?? null,
      },
      leadRewrites: remove.flatMap(row => (leadReferences[row.$id] ?? []).map(leadId => ({
        leadId, fromRequestId: row.$id, toRequestId: keeper.$id,
      }))),
    };
  });
  return { duplicates, invalid,
    crossCompanyProfiles: [...profiles.values()].filter(companies => companies.size > 1).length };
}
