import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { sendNotificationEmail } from "@/lib/server/email-service";
import { getReportEmails } from "@/lib/server/report-email-settings";
import type { LinkedinRequest, User } from "@/lib/types";
import { shouldAutoWithdrawLinkedinRequest } from "@/lib/utils/linkedin-withdrawal-reminders";

type Databases = Awaited<ReturnType<typeof createAdminClient>>["databases"];

export type LinkedinWithdrawalReason = "inactive agent" | "expired request";
export type LinkedinWithdrawal = {
  request: LinkedinRequest;
  agentName: string;
  reason: LinkedinWithdrawalReason;
};

export async function listActiveLinkedinRequests(databases: Databases, agentId?: string) {
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  return listAllDocuments<LinkedinRequest>({
    databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [Query.equal("isActive", true), Query.equal("status", ["sent", "accepted"]),
      ...(agentId ? [Query.equal("agentId", agentId)] : [])],
  });
}

export function planLinkedinWithdrawals(
  requests: LinkedinRequest[], users: Pick<User, "$id" | "name" | "isActive">[], now: Date,
): LinkedinWithdrawal[] {
  const usersById = new Map(users.map(user => [user.$id, user]));
  return requests.flatMap(request => {
    if (request.isActive === false || !["sent", "accepted"].includes(request.status)) return [];
    const agent = usersById.get(request.agentId);
    const reason: LinkedinWithdrawalReason | null = agent?.isActive === false ? "inactive agent" :
      shouldAutoWithdrawLinkedinRequest({ request, now }) ? "expired request" : null;
    return reason ? [{ request, agentName: agent?.name || request.agentId, reason }] : [];
  });
}

export async function applyLinkedinWithdrawals(databases: Databases, planned: LinkedinWithdrawal[], now: Date,
  onProgress?: (processed: number, total: number) => void) {
  const withdrawn: LinkedinWithdrawal[] = [];
  const errors: Array<{ requestId: string; message: string }> = [];
  const processEntry = async (entry: LinkedinWithdrawal) => {
    try {
      const current = await databases.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS,
        entry.request.$id) as unknown as LinkedinRequest;
      if (current.isActive === false || !["sent", "accepted"].includes(current.status) ||
          current.agentId !== entry.request.agentId) return;
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, current.$id, {
        status: "withdrawn", isActive: false, withdrawnAt: now.toISOString(),
      });
      withdrawn.push({ ...entry, request: current });
    } catch (error) {
      errors.push({ requestId: entry.request.$id,
        message: error instanceof Error ? error.message : String(error) });
    }
  };
  for (let start = 0; start < planned.length; start += 10) {
    await Promise.all(planned.slice(start, start + 10).map(processEntry));
    onProgress?.(Math.min(start + 10, planned.length), planned.length);
  }
  return { withdrawn, errors };
}

export async function runLinkedinWithdrawalSweep(databases: Databases, now: Date) {
  const [requests, users] = await Promise.all([
    listActiveLinkedinRequests(databases),
    listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.select(["$id", "name", "isActive"])] }),
  ]);
  const planned = planLinkedinWithdrawals(requests, users, now);
  return { evaluated: requests.length, planned, ...await applyLinkedinWithdrawals(databases, planned, now) };
}

export async function withdrawLinkedinRequestsForAgent(
  databases: Databases, agent: Pick<User, "$id" | "name">, now: Date,
) {
  const requests = await listActiveLinkedinRequests(databases, agent.$id);
  const planned: LinkedinWithdrawal[] = requests.map(request => ({
    request, agentName: agent.name, reason: "inactive agent",
  }));
  return { planned, ...await applyLinkedinWithdrawals(databases, planned, now) };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

function csvCell(value: string) {
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function sendLinkedinWithdrawalReport(
  databases: Databases, withdrawn: LinkedinWithdrawal[], now: Date,
  options: { sendEmpty?: boolean; failedCount?: number } = {},
) {
  if (withdrawn.length === 0 && !options.sendEmpty) return { emailSent: false, recipientCount: 0 };
  const recipients = await getReportEmails(databases);
  if (recipients.length === 0) return { emailSent: false, recipientCount: 0 };
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const rows = withdrawn.slice(0, 100).map(({ request, agentName, reason }) => `<tr>
    <td>${escapeHtml(agentName)}</td><td>${escapeHtml(request.company)}</td>
    <td>${escapeHtml(request.targetUrl)}</td><td>${escapeHtml(reason)}</td></tr>`).join("");
  const html = `<h2>LinkedIn withdrawal report - ${escapeHtml(date)}</h2>
    <p>${withdrawn.length} request(s) withdrawn.${options.failedCount ? ` ${options.failedCount} request(s) could not be withdrawn.` : ''} The attached CSV contains the complete list of actual withdrawals.</p>
    <table border="1" cellpadding="6" cellspacing="0"><thead><tr>
    <th>Agent</th><th>Company</th><th>Profile</th><th>Reason</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  const csv = ['Agent,Company,Profile,Reason,Request ID', ...withdrawn.map(({ request, agentName, reason }) =>
    [agentName, request.company, request.targetUrl, reason, request.$id].map(csvCell).join(','))].join('\r\n');
  const sent = await sendNotificationEmail({ to: recipients.join(","),
    subject: `LinkedIn Withdrawal Report - ${date}`, html, allowAllRecipients: true,
    attachments: [{ filename: `linkedin-withdrawals-${date}.csv`, content: csv, contentType: 'text/csv' }] });
  return { emailSent: Boolean(sent), recipientCount: recipients.length };
}
