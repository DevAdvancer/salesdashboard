"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import type { MonthlyTarget, MonthlyTargetAssignment, User } from "@/lib/types";
import { getAgentsByTeamLead, getUserByIdOrNull } from "@/lib/services/user-service";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";

/**
 * Server actions for the monthly-target feature.
 *
 * Two collections are involved:
 *   • `monthly_targets`            — one row per (team_lead_id, month_key),
 *                                    carrying the team total set by an admin.
 *   • `monthly_target_assignments` — one row per (monthly_target_id, agent_id),
 *                                    carrying the per-agent split set by the TL.
 *
 * Admin sets the team total. The TL splits it across agents. The
 * Target-Report page (app/target-report/page.tsx) reads both, sums
 * payments received from `client_payments.updates[].amount` for each
 * lead, and divides by the target to compute achievement.
 *
 * Payments attributed to a lead are excluded from the achievement
 * calculation when the lead's `data.source` is "referral" (see
 * lib/utils/monthly-target-report.ts).
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getActor(userId: string): Promise<User> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    return {
      $id: doc.$id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      teamLeadId: doc.teamLeadId || null,
      branchIds: doc.branchIds || [],
      branchId: doc.branchId || null,
      // `department` defaults to "sales" — anything that isn't explicitly
      // "resume" is treated as sales per `normalizeDepartment` in
      // lib/services/user-service.ts. The target-report page is
      // sales-only, so the value is read here so callers can use it to
      // filter the readable TL / agent set.
      department: doc.department === "resume" ? "resume" : "sales",
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    } as User;
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

function isAdminLike(role: User["role"]): boolean {
  return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

function isTargetReportEligible(role: User["role"]): boolean {
  return isRoleEligibleForComponent("target-report", role);
}

/**
 * True when `doc.department` is "sales" — the only department the
 * Target Report covers. Resume-department users are out of scope
 * because the report aggregates money and lead counts from the
 * sales CRM.
 *
 * The Appwrite `users.department` field is a free-form string in
 * practice; we treat anything that isn't exactly "resume" as "sales",
 * matching `normalizeDepartment` in lib/services/user-service.ts.
 */
function isSalesDepartmentDoc(doc: { department?: unknown }): boolean {
  return doc?.department !== "resume";
}

function parseAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
  }
  return 0;
}

function mapTarget(doc: any): MonthlyTarget {
  return {
    $id: doc.$id,
    teamLeadId: typeof doc.teamLeadId === "string" ? doc.teamLeadId : "",
    teamLeadName: typeof doc.teamLeadName === "string" ? doc.teamLeadName : null,
    monthKey: typeof doc.monthKey === "string" ? doc.monthKey : "",
    totalAmount: parseAmount(doc.totalAmount),
    note: typeof doc.note === "string" ? doc.note : null,
    createdById: typeof doc.createdById === "string" ? doc.createdById : "",
    createdByName: typeof doc.createdByName === "string" ? doc.createdByName : null,
    createdAt:
      typeof doc.$createdAt === "string" ? doc.$createdAt : new Date().toISOString(),
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    updatedById: typeof doc.updatedById === "string" ? doc.updatedById : null,
    updatedByName: typeof doc.updatedByName === "string" ? doc.updatedByName : null,
  };
}

function mapAssignment(doc: any): MonthlyTargetAssignment {
  return {
    $id: doc.$id,
    monthlyTargetId: typeof doc.monthlyTargetId === "string" ? doc.monthlyTargetId : "",
    teamLeadId: typeof doc.teamLeadId === "string" ? doc.teamLeadId : "",
    agentId: typeof doc.agentId === "string" ? doc.agentId : "",
    agentName: typeof doc.agentName === "string" ? doc.agentName : null,
    amount: parseAmount(doc.amount),
    createdAt:
      typeof doc.$createdAt === "string" ? doc.$createdAt : new Date().toISOString(),
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    updatedById: typeof doc.updatedById === "string" ? doc.updatedById : null,
    updatedByName: typeof doc.updatedByName === "string" ? doc.updatedByName : null,
  };
}

function assertMonthKey(monthKey: string): void {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("Invalid month. Use YYYY-MM.");
  }
}

// ─── Team-lead scope helpers ─────────────────────────────────────────────

/**
 * Returns the list of TL ids whose monthly-targets the actor is allowed
 * to read:
 *   • Admin-like: every TL on the platform.
 *   • Team lead:  just themselves.
 *   • Agent:      just the TL they report to.
 *   • Other roles: empty.
 */
async function resolveReadableTeamLeadIds(actor: User): Promise<string[]> {
  if (actor.role === "team_lead") {
    return [actor.$id];
  }
  if (actor.role === "agent" || actor.role === "lead_generation") {
    if (actor.teamLeadId) return [actor.teamLeadId];
    return [];
  }
  if (isAdminLike(actor.role)) {
    const { databases } = await createAdminClient();
    const tlDocs = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [Query.equal("role", "team_lead"), Query.select(["$id", "department"])],
      pageLimit: 100,
      maxPages: 200,
    });
    // Sales-only — exclude resume-department TLs so an admin's report
    // never surfaces resume teams. Department is checked in memory
    // because the Appwrite `users` collection stores it as a free-form
    // string.
    return Array.from(new Set(tlDocs.filter(isSalesDepartmentDoc).map((d) => d.$id)));
  }
  return [];
}

/**
 * Returns the list of agent ids whose achievements the actor is allowed
 * to read on the target report:
 *   • Admin-like: every agent / lead_generation user on the platform.
 *   • Team lead:  themselves + their direct reports.
 *   • Agent:      just themselves.
 *   • Other roles: empty.
 */
async function resolveReadableAgentIds(actor: User): Promise<string[]> {
  if (actor.role === "agent" || actor.role === "lead_generation") {
    return [actor.$id];
  }
  if (actor.role === "team_lead") {
    // Sales-only — getAgentsByTeamLead already accepts a department
    // scope; "sales" filters resume agents out of the report.
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    const ids = new Set<string>([actor.$id, ...agents.map((a) => a.$id)]);
    return Array.from(ids);
  }
  if (isAdminLike(actor.role)) {
    const { databases } = await createAdminClient();
    const docs = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [
        Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
        Query.select(["$id", "department"]),
      ],
      pageLimit: 100,
      maxPages: 200,
    });
    // Sales-only — drop resume agents in memory. The `users` collection
    // stores `department` as a free-form string.
    return Array.from(new Set(docs.filter(isSalesDepartmentDoc).map((d) => d.$id)));
  }
  return [];
}

// ─── Read actions ───────────────────────────────────────────────────────

export async function listMonthlyTargetsAction(input: {
  actorId: string;
  monthKey?: string;
}): Promise<MonthlyTarget[]> {
  const actor = await getActor(input.actorId);
  if (!isTargetReportEligible(actor.role)) {
    throw new Error("Not authorized");
  }

  const readableTlIds = await resolveReadableTeamLeadIds(actor);
  if (readableTlIds.length === 0) return [];

  const { databases } = await createAdminClient();
  const queries: any[] = [Query.equal("teamLeadId", readableTlIds)];
  if (input.monthKey) {
    assertMonthKey(input.monthKey);
    queries.push(Query.equal("monthKey", input.monthKey));
  }

  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.MONTHLY_TARGETS,
    queries,
    pageLimit: 100,
    maxPages: 200,
  });

  return docs.map(mapTarget);
}

export async function listMonthlyTargetAssignmentsAction(input: {
  actorId: string;
  monthlyTargetId: string;
}): Promise<MonthlyTargetAssignment[]> {
  const actor = await getActor(input.actorId);
  if (!isTargetReportEligible(actor.role)) {
    throw new Error("Not authorized");
  }

  const { databases } = await createAdminClient();
  const targetDoc = await databases
    .getDocument(DATABASE_ID, COLLECTIONS.MONTHLY_TARGETS, input.monthlyTargetId)
    .catch(() => null);
  if (!targetDoc) return [];

  const readableTlIds = await resolveReadableTeamLeadIds(actor);
  if (!readableTlIds.includes(String(targetDoc.teamLeadId))) {
    throw new Error("Not authorized");
  }

  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
    queries: [Query.equal("monthlyTargetId", input.monthlyTargetId)],
    pageLimit: 200,
    maxPages: 50,
  });

  return docs.map(mapAssignment);
}

/**
 * Convenience for the report page: returns a `monthKey -> target` map
 * for every TL the actor can read, and a `monthlyTargetId ->
 * assignments[]` map for the same. Two requests instead of one per
 * target row.
 */
export async function listMonthlyTargetsWithAssignmentsAction(input: {
  actorId: string;
  monthKey: string;
}): Promise<{
  targets: MonthlyTarget[];
  assignmentsByTargetId: Record<string, MonthlyTargetAssignment[]>;
}> {
  const actor = await getActor(input.actorId);
  if (!isTargetReportEligible(actor.role)) {
    throw new Error("Not authorized");
  }

  const targets = await listMonthlyTargetsAction({
    actorId: input.actorId,
    monthKey: input.monthKey,
  });
  if (targets.length === 0) {
    return { targets: [], assignmentsByTargetId: {} };
  }

  const { databases } = await createAdminClient();
  const targetIds = targets.map((t) => t.$id);
  const allAssignments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
    queries: [Query.equal("monthlyTargetId", targetIds)],
    pageLimit: 200,
    maxPages: 100,
  });

  const assignmentsByTargetId: Record<string, MonthlyTargetAssignment[]> = {};
  for (const doc of allAssignments) {
    const a = mapAssignment(doc);
    if (!assignmentsByTargetId[a.monthlyTargetId]) {
      assignmentsByTargetId[a.monthlyTargetId] = [];
    }
    assignmentsByTargetId[a.monthlyTargetId].push(a);
  }

  return { targets, assignmentsByTargetId };
}

// ─── Write actions (admin) ───────────────────────────────────────────────

/**
 * Upsert the team-level target for a TL for a given month. Admin-only.
 * If a row already exists for (teamLeadId, monthKey) it is updated in
 * place; otherwise a new document is created.
 */
export async function upsertMonthlyTeamTargetAction(input: {
  actorId: string;
  teamLeadId: string;
  monthKey: string;
  totalAmount: number;
  note?: string | null;
}): Promise<MonthlyTarget> {
  const actor = await getActor(input.actorId);
  if (!isAdminLike(actor.role)) {
    throw new Error("Not authorized");
  }
  if (actor.role === "monitor" || actor.role === "operations") {
    throw new Error("Not authorized");
  }
  assertMonthKey(input.monthKey);

  const tl = await getUserByIdOrNull(input.teamLeadId);
  if (!tl || tl.role !== "team_lead") {
    throw new Error("Selected user is not a team lead");
  }
  // The target report is sales-only — refuse to write a target for a
  // TL from another department (e.g. resume).
  if (tl.department === "resume") {
    throw new Error("Cannot set a target for a non-sales team lead.");
  }

  const { databases } = await createAdminClient();
  const amount = parseAmount(input.totalAmount);
  const now = new Date().toISOString();

  const existing = await databases
    .listDocuments(DATABASE_ID, COLLECTIONS.MONTHLY_TARGETS, [
      Query.equal("teamLeadId", input.teamLeadId),
      Query.equal("monthKey", input.monthKey),
      Query.limit(1),
    ])
    .then((r) => r.documents[0] ?? null);

  const payload = {
    teamLeadId: input.teamLeadId,
    teamLeadName: tl.name,
    monthKey: input.monthKey,
    totalAmount: amount,
    note: input.note ?? null,
    createdById: existing?.createdById ?? actor.$id,
    createdByName: existing?.createdByName ?? actor.name,
    createdAt: existing?.$createdAt ?? now,
    updatedAt: now,
    updatedById: actor.$id,
    updatedByName: actor.name,
  };

  const doc = existing
    ? await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.MONTHLY_TARGETS,
        existing.$id,
        payload,
      )
    : await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.MONTHLY_TARGETS,
        ID.unique(),
        payload,
      );

  return mapTarget(doc);
}

// ─── Write actions (team lead) ───────────────────────────────────────────

/**
 * Replace the per-agent split for a given monthly target. Caller passes
 * the full list of agentId -> amount pairs they want stored; rows not
 * in the list are deleted. Restricted to the TL who owns the target.
 */
export async function replaceMonthlyTargetAssignmentsAction(input: {
  actorId: string;
  monthlyTargetId: string;
  assignments: Array<{ agentId: string; amount: number }>;
}): Promise<MonthlyTargetAssignment[]> {
  const actor = await getActor(input.actorId);
  if (actor.role !== "team_lead") {
    throw new Error("Not authorized");
  }

  const { databases } = await createAdminClient();
  const target = await databases
    .getDocument(DATABASE_ID, COLLECTIONS.MONTHLY_TARGETS, input.monthlyTargetId)
    .catch(() => null);
  if (!target) throw new Error("Target not found");
  if (String(target.teamLeadId) !== actor.$id) {
    throw new Error("Not authorized");
  }

  // Sales-only — getAgentsByTeamLead with "sales" scope drops resume
  // agents from `teamAgents`, so any assignment the caller submits for
  // a resume agent is silently filtered out by the sanitization loop
  // below.
  const teamAgents = await getAgentsByTeamLead(actor.$id, "sales");
  const validAgentIds = new Set<string>(teamAgents.map((a) => a.$id));
  if (actor.teamLeadId && !validAgentIds.has(actor.$id)) {
    // Allow the TL to assign themselves too — but only if they are
    // actually a TL (which they are). The TLs aren't usually listed by
    // getAgentsByTeamLead, so we add them manually.
    validAgentIds.add(actor.$id);
  }

  // Sanitize input: drop agents not in the TL's team, drop non-positive amounts.
  const cleaned: Array<{ agentId: string; agentName: string; amount: number }> = [];
  for (const a of input.assignments) {
    if (!a || typeof a.agentId !== "string" || !validAgentIds.has(a.agentId)) continue;
    const amount = parseAmount(a.amount);
    if (amount <= 0) continue;
    const agent = teamAgents.find((x) => x.$id === a.agentId);
    cleaned.push({
      agentId: a.agentId,
      agentName: agent?.name ?? a.agentId,
      amount,
    });
  }

  // Diff against existing rows.
  const existingDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
    queries: [Query.equal("monthlyTargetId", input.monthlyTargetId)],
    pageLimit: 200,
    maxPages: 10,
  });
  const existingByAgent = new Map<string, any>(
    existingDocs.map((d) => [String(d.agentId), d]),
  );
  const newAgentIds = new Set(cleaned.map((c) => c.agentId));

  const now = new Date().toISOString();
  const results: MonthlyTargetAssignment[] = [];

  for (const next of cleaned) {
    const existing = existingByAgent.get(next.agentId);
    if (existing) {
      const updated = await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
        existing.$id,
        {
          amount: next.amount,
          agentName: next.agentName,
          updatedAt: now,
          updatedById: actor.$id,
          updatedByName: actor.name,
        },
      );
      results.push(mapAssignment(updated));
    } else {
      const created = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
        ID.unique(),
        {
          monthlyTargetId: input.monthlyTargetId,
          teamLeadId: actor.$id,
          agentId: next.agentId,
          agentName: next.agentName,
          amount: next.amount,
          createdAt: now,
          updatedAt: now,
          updatedById: actor.$id,
          updatedByName: actor.name,
        },
      );
      results.push(mapAssignment(created));
    }
  }

  // Delete rows that disappeared from the new list.
  for (const existing of existingDocs) {
    if (!newAgentIds.has(String(existing.agentId))) {
      await databases.deleteDocument(
        DATABASE_ID,
        COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
        existing.$id,
      );
    }
  }

  return results;
}

// ─── Eligible team leads (for admin form) ───────────────────────────────

export interface TeamLeadOption {
  $id: string;
  name: string;
}

export async function listTeamLeadsForTargetAction(input: {
  actorId: string;
}): Promise<TeamLeadOption[]> {
  const actor = await getActor(input.actorId);
  if (!isAdminLike(actor.role)) {
    throw new Error("Not authorized");
  }
  const { databases } = await createAdminClient();
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.equal("role", "team_lead"),
      Query.select(["$id", "name", "department"]),
      Query.orderAsc("name"),
    ],
    pageLimit: 100,
    maxPages: 50,
  });
  // Sales-only — drop resume TLs so the admin's "Set Team Target"
  // dropdown never offers a non-sales team.
  return docs.filter(isSalesDepartmentDoc).map((d) => ({
    $id: d.$id,
    name: typeof d.name === "string" ? d.name : "(unnamed)",
  }));
}

// ─── Eligible agents (for TL split form) ────────────────────────────────

export interface AgentOption {
  $id: string;
  name: string;
  email: string;
}

export async function listTeamAgentsForTargetAction(input: {
  actorId: string;
}): Promise<AgentOption[]> {
  const actor = await getActor(input.actorId);
  if (actor.role !== "team_lead" && !isAdminLike(actor.role)) {
    throw new Error("Not authorized");
  }
  if (actor.role === "team_lead") {
    // Sales-only — getAgentsByTeamLead with "sales" scope excludes
    // resume agents from the split-form dropdown.
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    return agents.map((a) => ({
      $id: a.$id,
      name: a.name,
      email: a.email,
    }));
  }
  // Admin read-only: every agent in the system (sales-only).
  const { databases } = await createAdminClient();
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
      Query.select(["$id", "name", "email", "department"]),
      Query.orderAsc("name"),
    ],
    pageLimit: 100,
    maxPages: 50,
  });
  return docs.filter(isSalesDepartmentDoc).map((d) => ({
    $id: d.$id,
    name: typeof d.name === "string" ? d.name : "(unnamed)",
    email: typeof d.email === "string" ? d.email : "",
  }));
}
