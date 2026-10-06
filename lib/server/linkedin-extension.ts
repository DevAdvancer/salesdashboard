import { createHash } from "node:crypto";
import { Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { listMyLinkedinAccountsAction } from "@/app/actions/linkedin/accounts";
import { createLinkedinRequestAction } from "@/app/actions/linkedin/requests";
import { logAuditAction, assertAccessibleLinkedinAccount, isBlockingLinkedinRequest } from "@/app/actions/linkedin/shared";
import { validateLeadUniquenessAction } from "@/app/actions/lead/validation";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { normalizeProfileUrl, sameProfile } from "@/lib/utils/linkedin-extension-url";
import { canUseLinkedinExtension, LinkedinExtensionError, projectExtensionHistory } from "./linkedin-extension-policy";
import type { LinkedinAccount, LinkedinRequest } from "@/lib/types";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionRecord, ExtensionState } from "@/lib/types/linkedin-extension";

type Databases = Awaited<ReturnType<typeof createAdminClient>>["databases"];

async function context() {
  const { databases } = await createAdminClient();
  // Extension eligibility and mutations must use current assignments/usage, not a two-hour cache.
  for (const collection of [COLLECTIONS.USERS, COLLECTIONS.LINKEDIN_ACCOUNTS,
    COLLECTIONS.ATTENDANCE, COLLECTIONS.LINKEDIN_REQUESTS, COLLECTIONS.LEADS]) {
    databases.clearReadCacheForCollection(collection);
  }
  const actor = await getAuthenticatedUserDoc().catch(() => {
    throw new LinkedinExtensionError(401, "Sign in to CRM in the connected tab, then retry.");
  });
  if (!canUseLinkedinExtension(actor)) throw new LinkedinExtensionError(403, "Your CRM role or department cannot use LinkedIn Requests.");
  return { actor, databases, today: getCurrentEasternIsoDate() };
}

async function usage(databases: Databases, account: LinkedinAccount, today: string) {
  const records = await listAllDocuments<LinkedinRequest>({
    databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [Query.equal("accountId", account.$id), Query.equal("dateSent", `${today}T00:00:00.000Z`),
      Query.select(["$id", "isActive", "status"])],
  });
  const used = records.filter(r => (r.isActive ?? true) && r.status !== "withdrawn").length;
  const limit = typeof account.connectionLimit === "number" && Number.isFinite(account.connectionLimit)
    ? Math.max(0, Math.floor(account.connectionLimit)) : null;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}

function projectAccount(account: LinkedinAccount) {
  return { id: account.$id, name: account.idName, company: account.company,
    type: account.accountType, connectionLimit: account.connectionLimit ?? null };
}

export async function bootstrapLinkedinExtension(): Promise<ExtensionBootstrap> {
  const { actor, databases, today } = await context();
  const accounts = await listMyLinkedinAccountsAction({ currentUserId: actor.$id });
  return { user: { id: actor.$id, name: actor.name }, today,
    accounts: await Promise.all(accounts.map(async account => ({ ...projectAccount(account),
      ...await usage(databases, account, today) }))) };
}

async function inspect(input: { accountId: string; targetUrl: string }) {
  const { actor, databases, today } = await context();
  let targetUrl: string;
  try { targetUrl = normalizeProfileUrl(input.targetUrl); }
  catch (error) { throw new LinkedinExtensionError(400, error instanceof Error ? error.message : "Invalid profile URL."); }
  const account = await assertAccessibleLinkedinAccount(databases, actor.$id, input.accountId)
    .catch(() => { throw new LinkedinExtensionError(403, "This account is no longer assigned or delegated to you."); });
  if (!account.isActive) throw new LinkedinExtensionError(409, "This LinkedIn account is inactive. Choose another account.");
  // Filter on the server before pagination; exact normalization still rejects neighboring slugs.
  const queryRecords = (targeted: boolean) => listAllDocuments<LinkedinRequest>({
    databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [Query.equal("company", account.company.trim()),
      ...(targeted ? [Query.contains("targetUrl", new URL(targetUrl).pathname)] : []), Query.orderDesc("$createdAt")],
  });
  const companyPromise = queryRecords(true).catch(error => {
    // Older Appwrite deployments may not support string contains. Preserve legacy matching.
    if ((error as { code?: number }).code === 400) return queryRecords(false);
    throw error;
  });
  const [companyRecords, quota, leadCheck] = await Promise.all([
    companyPromise, usage(databases, account, today), validateLeadUniquenessAction({ linkedinProfileUrl: targetUrl }),
  ]);
  const records = companyRecords.filter(record => sameProfile(record.targetUrl, targetUrl));
  const blocking = await Promise.all(records.map(async record => ({ record, blocks: await isBlockingLinkedinRequest(databases, record) })));
  const active = blocking.find(item => item.blocks)?.record;
  const latest = records[0];
  const state: ExtensionState = !leadCheck.isValid ? "lead_exists" : active ? "active_request" :
    quota.limit === null ? "missing_limit" : quota.remaining === 0 ? "limit_reached" :
    latest ? "resend_available" : "new";
  return { actor, databases, today, account, targetUrl, records, latest, state, quota };
}

type Inspection = Awaited<ReturnType<typeof inspect>>;
function result(value: Inspection, includeHistory = false): ExtensionCheck {
  const { actor, today, account, targetUrl, records, state, quota } = value;
  return { today, targetUrl, user: { id: actor.$id, name: actor.name }, account: projectAccount(account), state, ...quota,
    canRecord: state === "new" || state === "resend_available",
    // Opaque revision proves the user checked the exact account/profile/history before saving.
    revision: createHash("sha256").update(JSON.stringify([actor.$id, account.$id, targetUrl, today,
      records.map(r => [r.$id, r.$updatedAt, r.status, r.dateSent, r.agentId])])).digest("hex"),
    history: includeHistory ? records.map(record => projectExtensionHistory(record, actor.$id)) : [] };
}

export async function checkLinkedinExtension(input: { accountId: string; targetUrl: string }, includeHistory = false) {
  return result(await inspect(input), includeHistory);
}

export async function recordLinkedinExtension(input: {
  accountId: string; targetUrl: string; revision?: string; confirmResend: boolean;
}): Promise<ExtensionRecord> {
  const current = await inspect(input);
  const checked = result(current);
  if (input.revision && checked.revision !== input.revision) throw new LinkedinExtensionError(409, "The profile history or business date changed. Check again before recording.");
  if (!input.revision && (!checked.canRecord || current.latest)) return { ...checked, mode: "existing" };
  if (!checked.canRecord) throw new LinkedinExtensionError(409, "This request cannot be recorded. Check the profile for its current status.");
  if (current.latest && (!input.confirmResend || !input.revision)) throw new LinkedinExtensionError(409, "Confirm the resend before changing the existing request.");
  let mode: "created" | "resent";
  if (current.latest) {
    // Reuse the existing resend business operation, including its permission and limit checks.
    // Preserve the stored URL so legacy rows are updated rather than duplicated.
    const saved = await createLinkedinRequestAction({ currentUserId: current.actor.$id,
      accountId: current.account.$id, targetUrl: current.latest.targetUrl, dateSent: current.today });
    mode = saved.mode;
  } else {
    // Stable company/profile ID makes concurrent extension creates collide at the database.
    // Schema and record shape are identical to the existing CRM; no extra attributes are introduced.
    const id = `ext_${createHash("sha256").update(JSON.stringify([current.account.company.trim(), current.targetUrl])).digest("hex").slice(0, 32)}`;
    try {
      await current.databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, id, {
        accountId: current.account.$id, agentId: current.actor.$id, teamLeadId: current.actor.teamLeadId || null,
        company: current.account.company.trim(), targetUrl: current.targetUrl,
        dateSent: `${current.today}T00:00:00.000Z`, status: "sent", acceptedAt: null,
        leadId: null, withdrawnAt: null, isActive: true,
      }, [Permission.read(Role.user(current.actor.$id)), Permission.update(Role.user(current.actor.$id)),
        Permission.delete(Role.user(current.actor.$id)), Permission.read(Role.label("admin"))]);
      await logAuditAction(current.databases, { action: "LINKEDIN_REQUEST_CREATE", actorId: current.actor.$id,
        actorName: current.actor.name, targetType: "linkedin_request", targetId: id,
        metadata: { accountId: current.account.$id, company: current.account.company.trim(),
          targetUrl: current.targetUrl, dateSent: `${current.today}T00:00:00.000Z`, source: "extension" } });
    } catch (error) {
      if ((error as { code?: number }).code === 409) throw new LinkedinExtensionError(409, "This profile was recorded while you were checking. Check again; no second request was added.");
      throw error;
    }
    mode = "created";
  }
  // The completed write is authoritative. Avoid repeating every scan just to construct its response.
  const wasCountedToday = current.latest?.dateSent === `${current.today}T00:00:00.000Z` &&
    (current.latest.isActive ?? true) && current.latest.status !== "withdrawn";
  const used = checked.used + (wasCountedToday ? 0 : 1);
  return { ...checked, mode, state: "active_request", canRecord: false, history: [],
    used, remaining: checked.limit === null ? null : Math.max(0, checked.limit - used) };
}
