"use server";

import { ID, Query } from "node-appwrite";
import { listLeadsAction } from "@/app/actions/lead";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import {
  buildFormFieldTargetOptions,
  buildLeadTargetOptions,
  buildUserTargetOptions,
  filterReviewTargetOptions,
  type ReviewTargetOption,
  type ReviewTargetType,
} from "@/lib/utils/review-target-options";
import type {
  CoachingNote,
  CoachingNoteVisibility,
  FormField,
  Lead,
  LeadNote,
  LeadNoteVisibility,
  NotificationRecord,
  ReviewQueueItem,
  User,
  UserRole,
} from "@/lib/types";

async function getActor(userId: string): Promise<User> {
  const { databases } = await createAdminClient();
  const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    managerId: doc.managerId || null,
    managerIds: doc.managerIds || [],
    assistantManagerId: doc.assistantManagerId || null,
    assistantManagerIds: doc.assistantManagerIds || [],
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  } as User;
}

function ensureComponentAccess(role: UserRole, componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
  if (!isRoleEligibleForComponent(componentKey, role)) {
    throw new Error("Not authorized");
  }
}

function ensureLeadership(role: UserRole) {
  if (!["admin", "manager", "assistant_manager", "team_lead"].includes(role)) {
    throw new Error("Not authorized");
  }
}

function getDefaultReviewFormFields(): FormField[] {
  return [
    { id: "1", type: "text", label: "First Name", key: "firstName", required: true, visible: true, order: 1 },
    { id: "2", type: "text", label: "Last Name", key: "lastName", required: false, visible: true, order: 2 },
    { id: "3", type: "email", label: "Email", key: "email", required: true, visible: true, order: 3 },
    { id: "4", type: "phone", label: "Phone", key: "phone", required: false, visible: true, order: 4 },
    { id: "5", type: "text", label: "Company", key: "company", required: false, visible: true, order: 5 },
    { id: "7", type: "dropdown", label: "Status", key: "status", required: true, visible: true, order: 7 },
    { id: "13", type: "textarea", label: "Notes", key: "notes", required: false, visible: true, order: 11 },
    { id: "15", type: "text", label: "Amount ($)", key: "amount", required: false, visible: true, order: 12 },
  ];
}

async function listVisibleReviewUsers(actor: User): Promise<User[]> {
  const { databases } = await createAdminClient();
  const queries: string[] = [];

  if (actor.role === "admin") {
    queries.push(Query.equal("role", ["manager", "assistant_manager", "team_lead", "agent"]));
  } else if (actor.role === "manager") {
    if (actor.branchIds.length === 0) {
      return [];
    }
    queries.push(Query.equal("role", ["assistant_manager", "team_lead", "agent"]));
    queries.push(Query.contains("branchIds", actor.branchIds));
  } else if (actor.role === "assistant_manager") {
    if (actor.branchIds.length === 0) {
      return [];
    }
    queries.push(Query.equal("role", ["team_lead", "agent"]));
    queries.push(Query.contains("branchIds", actor.branchIds));
  } else if (actor.role === "team_lead") {
    queries.push(Query.equal("role", "agent"));
    queries.push(Query.equal("teamLeadId", actor.$id));
  } else {
    return [];
  }

  queries.push(Query.limit(200));

  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, queries);
  return response.documents
    .filter((doc) => doc.$id !== actor.$id)
    .map((doc) => ({
      $id: doc.$id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      managerId: doc.managerId || null,
      managerIds: doc.managerIds || [],
      assistantManagerId: doc.assistantManagerId || null,
      assistantManagerIds: doc.assistantManagerIds || [],
      teamLeadId: doc.teamLeadId || null,
      branchIds: doc.branchIds || [],
      branchId: doc.branchId || null,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))) as User[];
}

async function listCurrentFormFields(): Promise<FormField[]> {
  const { databases } = await createAdminClient();

  try {
    const config = await databases.getDocument(DATABASE_ID, COLLECTIONS.FORM_CONFIG, "current");
    return JSON.parse(config.fields as string) as FormField[];
  } catch (error: unknown) {
    const appwriteError = error as { code?: number; message?: string };
    if (appwriteError.code === 404 || appwriteError.message?.includes("not found")) {
      return getDefaultReviewFormFields();
    }
    throw error;
  }
}

export async function updateLeadFollowUpAction(input: {
  actorId: string;
  leadId: string;
  nextFollowUpAt?: string | null;
  nextAction?: string | null;
  lastContactedAt?: string | null;
  followUpStatus?: string | null;
}): Promise<Lead> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "leads");

  const { databases } = await createAdminClient();
  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    input.leadId,
    {
      nextFollowUpAt: input.nextFollowUpAt ?? null,
      nextAction: input.nextAction ?? null,
      lastContactedAt: input.lastContactedAt ?? null,
      followUpStatus: input.followUpStatus ?? "pending",
    }
  );
  return doc as unknown as Lead;
}

export async function listLeadNotesAction(actorId: string, leadId: string): Promise<LeadNote[]> {
  const actor = await getActor(actorId);
  if (!isRoleEligibleForComponent("leads", actor.role) && !isRoleEligibleForComponent("history", actor.role)) {
    throw new Error("Not authorized");
  }

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LEAD_NOTES,
    [Query.equal("leadId", leadId), Query.orderDesc("createdAt"), Query.limit(100)]
  );
  return response.documents as unknown as LeadNote[];
}

export async function createLeadNoteAction(input: {
  actorId: string;
  leadId: string;
  body: string;
  visibility: LeadNoteVisibility;
}): Promise<LeadNote> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "leads");

  const { databases } = await createAdminClient();
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.LEAD_NOTES,
    ID.unique(),
    {
      leadId: input.leadId,
      authorId: actor.$id,
      authorName: actor.name,
      body: input.body,
      visibility: input.visibility,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  );
  return doc as unknown as LeadNote;
}

export async function listCoachingNotesAction(actorId: string, targetUserId?: string): Promise<CoachingNote[]> {
  const actor = await getActor(actorId);
  ensureLeadership(actor.role);

  const queries = [Query.orderDesc("createdAt"), Query.limit(200)];
  if (targetUserId) queries.push(Query.equal("targetUserId", targetUserId));

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.COACHING_NOTES, queries);
  return response.documents as unknown as CoachingNote[];
}

export async function createCoachingNoteAction(input: {
  actorId: string;
  targetUserId: string;
  targetUserName?: string | null;
  note: string;
  visibility: CoachingNoteVisibility;
}): Promise<CoachingNote> {
  const actor = await getActor(input.actorId);
  ensureLeadership(actor.role);

  const { databases } = await createAdminClient();
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.COACHING_NOTES,
    ID.unique(),
    {
      targetUserId: input.targetUserId,
      targetUserName: input.targetUserName ?? null,
      authorId: actor.$id,
      authorName: actor.name,
      note: input.note,
      visibility: input.visibility,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  );
  return doc as unknown as CoachingNote;
}

export async function listReviewQueueAction(actorId: string, status?: string): Promise<ReviewQueueItem[]> {
  const actor = await getActor(actorId);
  ensureComponentAccess(actor.role, "review-queue");

  const queries = [Query.orderDesc("createdAt"), Query.limit(200)];
  if (status) queries.push(Query.equal("status", status));

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.REVIEW_QUEUE, queries);
  return response.documents as unknown as ReviewQueueItem[];
}

export async function listReviewTargetOptionsAction(input: {
  actorId: string;
  targetType: ReviewTargetType;
  searchQuery?: string;
}): Promise<ReviewTargetOption[]> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "review-queue");

  const searchQuery = input.searchQuery?.trim() ?? "";
  let options: ReviewTargetOption[] = [];

  if (input.targetType === "LEAD" || input.targetType === "CLIENT") {
    const leads = await listLeadsAction(
      {
        isClosed: input.targetType === "CLIENT",
        searchQuery: searchQuery || undefined,
      },
      actor.$id,
      actor.role,
      actor.branchIds
    );
    options = buildLeadTargetOptions(leads, input.targetType);
  } else if (input.targetType === "USER") {
    options = buildUserTargetOptions(await listVisibleReviewUsers(actor));
  } else if (input.targetType === "FORM_FIELD") {
    options = buildFormFieldTargetOptions(await listCurrentFormFields());
  }

  return filterReviewTargetOptions(options, searchQuery).slice(0, 50);
}

export async function createReviewQueueItemAction(input: {
  actorId: string;
  type: string;
  targetId: string;
  targetType: string;
  assignedReviewerId?: string | null;
  reason?: string | null;
  metadata?: string | null;
}): Promise<ReviewQueueItem> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "review-queue");

  const { databases } = await createAdminClient();
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.REVIEW_QUEUE,
    ID.unique(),
    {
      type: input.type,
      status: "open",
      targetId: input.targetId,
      targetType: input.targetType,
      requestedById: actor.$id,
      requestedByName: actor.name,
      assignedReviewerId: input.assignedReviewerId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    }
  );
  return doc as unknown as ReviewQueueItem;
}

export async function updateReviewQueueStatusAction(
  actorId: string,
  itemId: string,
  status: string
): Promise<ReviewQueueItem> {
  const actor = await getActor(actorId);
  ensureLeadership(actor.role);

  const { databases } = await createAdminClient();
  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.REVIEW_QUEUE,
    itemId,
    {
      status,
      resolvedAt: status === "open" ? null : new Date().toISOString(),
    }
  );
  return doc as unknown as ReviewQueueItem;
}

export async function listNotificationsAction(actorId: string): Promise<NotificationRecord[]> {
  const actor = await getActor(actorId);
  ensureComponentAccess(actor.role, "notifications");

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    [Query.equal("recipientId", actor.$id), Query.orderDesc("createdAt"), Query.limit(100)]
  );
  return response.documents as unknown as NotificationRecord[];
}

export async function markNotificationReadAction(
  actorId: string,
  notificationId: string
): Promise<NotificationRecord> {
  const actor = await getActor(actorId);
  ensureComponentAccess(actor.role, "notifications");

  const { databases } = await createAdminClient();
  const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.NOTIFICATIONS, notificationId);
  if (existing.recipientId !== actor.$id) {
    throw new Error("Not authorized");
  }

  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    notificationId,
    { readAt: new Date().toISOString() }
  );
  return doc as unknown as NotificationRecord;
}
