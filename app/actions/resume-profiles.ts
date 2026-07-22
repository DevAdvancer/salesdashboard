'use server';

import { revalidatePath } from 'next/cache';
import { ID, Query, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import {
  RESUME_PROFILE_STAGES,
  type CallRequest,
  type ResumeProfile,
  type ResumeProfileStage,
  type User,
} from '@/lib/types';
import { getResumeTeamLeadIds, isResumeSide } from '@/lib/utils/resume-helpers';

type ResumeProfileDocument = ResumeProfile & { $id: string };

async function logAuditAction(
  databases: Databases,
  input: {
    action: string;
    actorId: string;
    actorName: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      targetId: input.targetId ?? null,
      targetType: 'resume_profile',
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      performedAt: new Date().toISOString(),
    });
  } catch {
    return;
  }
}

/**
 * Returns options for initializing and assigning Resume Profiles:
 * - callRequests: Call requests that are marked 'call_done'.
 * - assignableUsers: Active Resume team members (agents & team leads).
 */
export async function getResumeProfileOptionsAction() {
  try {
    const actor = await getAuthenticatedUserDoc();
    if (!actor || !isResumeSide(actor)) {
      return { callRequests: [], assignableUsers: [] };
    }

    const { databases } = await createAdminClient();

    const [callRequests, users] = await Promise.all([
      listAllDocuments<CallRequest & { $id: string }>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.CALL_REQUESTS,
        queries: [Query.equal('status', 'call_done')],
        pageLimit: 100,
        maxPages: 10,
      }).catch(() => [] as (CallRequest & { $id: string })[]),
      listAllDocuments<User>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        queries: [Query.equal('isActive', true)],
        pageLimit: 100,
        maxPages: 10,
      }).catch(() => [] as User[]),
    ]);

    const sortedCallRequests = [...callRequests].sort(
      (a, b) =>
        new Date(b.createdAt || (b as any).$createdAt || 0).getTime() -
        new Date(a.createdAt || (a as any).$createdAt || 0).getTime(),
    );

    const assignableUsers = users
      .filter((u) => (u as unknown as { department?: string }).department === 'resume')
      .filter((u) => u.role === 'agent' || u.role === 'team_lead')
      .map((u) => ({
        $id: u.$id,
        name: u.name,
        email: u.email,
      }));

    return { callRequests: sortedCallRequests, assignableUsers };
  } catch (error) {
    console.error('getResumeProfileOptionsAction error:', error);
    return { callRequests: [], assignableUsers: [] };
  }
}

export async function getResumeAssignableUsersAction() {
  try {
    const actor = await getAuthenticatedUserDoc();
    if (!actor || !isResumeSide(actor)) {
      return { assignableUsers: [] };
    }

    const { databases } = await createAdminClient();

    const users = await listAllDocuments<User>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('isActive', true)],
      pageLimit: 100,
      maxPages: 10,
    }).catch(() => [] as User[]);

    const assignableUsers = users
      .filter((u) => (u as unknown as { department?: string }).department === 'resume')
      .filter((u) => u.role === 'agent' || u.role === 'team_lead')
      .map((u) => ({
        $id: u.$id,
        name: u.name,
        email: u.email,
      }));

    return { assignableUsers };
  } catch (error) {
    console.error('getResumeAssignableUsersAction error:', error);
    return { assignableUsers: [] };
  }
}

/**
 * List all Resume Profiles visible to the current actor.
 * - Resume agents only see profiles assigned to them.
 * - Resume TLs, admins, developers, monitors, operations see all profiles.
 */
export interface ListResumeProfilesOptions {
  search?: string;
  stage?: string;
  assignedToId?: string;
  page?: number;
  limit?: number;
}

export async function listResumeProfilesAction(
  options: ListResumeProfilesOptions = {}
): Promise<{ documents: ResumeProfileDocument[]; total: number }> {
  try {
    const actor = await getAuthenticatedUserDoc();
    if (!actor || !isResumeSide(actor)) {
      return { documents: [], total: 0 };
    }

    const { databases } = await createAdminClient();
    const dept = (actor as unknown as { department?: string }).department;
    const queries: string[] = [];

    if (actor.role === 'agent' && dept === 'resume') {
      queries.push(Query.equal('assignedToId', actor.$id));
    } else if (options.assignedToId && options.assignedToId !== 'all') {
      if (options.assignedToId === 'unassigned') {
        queries.push(Query.isNull('assignedToId'));
      } else {
        queries.push(Query.equal('assignedToId', options.assignedToId));
      }
    }

    if (options.stage && options.stage !== 'all') {
      queries.push(Query.equal('stage', options.stage));
    }

    if (options.search) {
      // Basic fallback since multiple contains or fulltext might be restricted without indexes
      queries.push(Query.contains('candidateName', options.search));
    }

    queries.push(Query.orderDesc('stageUpdatedAt'));

    const limit = options.limit || 50;
    const page = options.page || 1;
    queries.push(Query.limit(limit));
    queries.push(Query.offset((page - 1) * limit));

    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.RESUME_PROFILES,
      queries
    );

    return {
      documents: (response.documents as unknown as ResumeProfileDocument[]),
      total: response.total,
    };
  } catch (error) {
    console.error('listResumeProfilesAction error:', error);
    return { documents: [], total: 0 };
  }
}

/**
 * Get a single Resume Profile by ID.
 */
export async function getResumeProfileByIdAction(id: string): Promise<ResumeProfileDocument | null> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    return null;
  }

  try {
    const { databases } = await createAdminClient();
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, id);
    return doc as unknown as ResumeProfileDocument;
  } catch {
    return null;
  }
}

export interface CreateResumeProfileInput {
  callRequestId?: string | null;
  leadId?: string | null;
  candidateName: string;
  technology?: string | null;
  usaArrival?: string | null;
  bachelors?: string | null;
  masters?: string | null;
  cpt?: string | null;
  cptDetails?: string | null;
  opt?: string | null;
  optDetails?: string | null;
  stemOpt?: string | null;
  stemOptDetails?: string | null;
  experience?: string | null;
  data?: string | null;
  missingDocs?: string | null;
  resumeTimeline?: string | null;
  remarks?: string | null;
  stage?: ResumeProfileStage | string;
  assignedToId?: string | null;
  assignedToName?: string | null;
}

/**
 * Create a new Resume Profile.
 */
export async function createResumeProfileAction(input: CreateResumeProfileInput): Promise<ResumeProfileDocument> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    throw new Error('Not authorized to create resume profiles');
  }

  const isLeadership =
    actor.role === 'admin' ||
    actor.role === 'developer' ||
    actor.role === 'monitor' ||
    actor.role === 'operations';
  const canExplicitlyCreate = actor.role === 'team_lead' || isLeadership;

  if (!canExplicitlyCreate) {
    throw new Error('Only Team Leads and Admins can explicitly create a resume profile.');
  }

  if (!input.candidateName?.trim()) {
    throw new Error('Candidate Name is required');
  }

  const { databases } = await createAdminClient();
  const now = new Date().toISOString();
  const stage = input.stage && RESUME_PROFILE_STAGES.includes(input.stage as any) ? input.stage : '1. Draft';

  const docData: Record<string, unknown> = {
    callRequestId: input.callRequestId ?? null,
    leadId: input.leadId ?? null,
    candidateName: input.candidateName.trim(),
    technology: input.technology?.trim() ?? null,
    usaArrival: input.usaArrival?.trim() ?? null,
    bachelors: input.bachelors?.trim() ?? null,
    masters: input.masters?.trim() ?? null,
    cpt: input.cpt?.trim() ?? null,
    cptDetails: input.cptDetails?.trim() ?? null,
    opt: input.opt?.trim() ?? null,
    optDetails: input.optDetails?.trim() ?? null,
    stemOpt: input.stemOpt?.trim() ?? null,
    stemOptDetails: input.stemOptDetails?.trim() ?? null,
    experience: input.experience?.trim() ?? null,
    data: input.data?.trim() ?? null,
    missingDocs: input.missingDocs?.trim() ?? null,
    resumeTimeline: input.resumeTimeline?.trim() ?? null,
    remarks: input.remarks?.trim() ?? null,
    stage,
    assignedToId: canExplicitlyCreate ? (input.assignedToId ?? null) : null,
    assignedToName: canExplicitlyCreate ? (input.assignedToName ?? null) : null,
    createdBy: actor.$id,
    createdByName: actor.name,
    createdAt: now,
    stageUpdatedAt: now,
  };

  const created = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    ID.unique(),
    docData,
  );

  await logAuditAction(databases, {
    action: 'resume_profile.created',
    actorId: actor.$id,
    actorName: actor.name,
    targetId: created.$id,
    metadata: { candidateName: input.candidateName, stage },
  });

  // Notify assigned user & Resume TLs
  const recipientIds = new Set<string>();
  if (input.assignedToId && input.assignedToId !== actor.$id) {
    recipientIds.add(input.assignedToId);
  }
  const tlIds = await getResumeTeamLeadIds(databases);
  tlIds.forEach((id) => {
    if (id !== actor.$id) recipientIds.add(id);
  });

  if (recipientIds.size > 0) {
    await createNotificationsForRecipients(
      databases,
      Array.from(recipientIds),
      {
        title: 'New Resume Profile Created',
        body: `${actor.name} created a resume profile for ${input.candidateName} (${stage}).`,
        targetId: created.$id,
        targetType: 'resume_profile',
        type: 'resume_profile_created',
      }
    );
  }

  revalidatePath('/resume');
  return created as unknown as ResumeProfileDocument;
}

export interface UpdateResumeProfileInput extends Partial<CreateResumeProfileInput> {
  $id: string;
}

/**
 * Update an existing Resume Profile.
 */
export async function updateResumeProfileAction(input: UpdateResumeProfileInput): Promise<ResumeProfileDocument> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    throw new Error('Not authorized to update resume profiles');
  }

  const { databases } = await createAdminClient();
  const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, input.$id);

  const isLeadership =
    actor.role === 'admin' ||
    actor.role === 'developer' ||
    actor.role === 'monitor' ||
    actor.role === 'operations';
  const canAssign = actor.role === 'team_lead' || isLeadership;

  if (
    (input.assignedToId !== undefined && input.assignedToId !== existing.assignedToId) ||
    (input.assignedToName !== undefined && input.assignedToName !== existing.assignedToName)
  ) {
    if (!canAssign) {
      throw new Error('Only Team Leads and Admins can assign or reassign resume profiles.');
    }
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  const fields: (keyof CreateResumeProfileInput)[] = [
    'callRequestId',
    'leadId',
    'candidateName',
    'technology',
    'usaArrival',
    'bachelors',
    'masters',
    'cpt',
    'cptDetails',
    'opt',
    'optDetails',
    'stemOpt',
    'stemOptDetails',
    'experience',
    'data',
    'missingDocs',
    'resumeTimeline',
    'remarks',
    'assignedToId',
    'assignedToName',
  ];

  for (const field of fields) {
    if (input[field] !== undefined) {
      const val = input[field];
      updates[field] = typeof val === 'string' ? val.trim() || null : val ?? null;
    }
  }

  const stageChanged = input.stage !== undefined && input.stage !== existing.stage;
  if (stageChanged && input.stage) {
    updates.stage = input.stage;
    updates.stageUpdatedAt = new Date().toISOString();
    updates.lastAlertStage = null;
    updates.lastAlertAt = null;
  }

  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    input.$id,
    updates,
  );

  await logAuditAction(databases, {
    action: 'resume_profile.updated',
    actorId: actor.$id,
    actorName: actor.name,
    targetId: input.$id,
    metadata: { stageChanged, oldStage: existing.stage, newStage: updates.stage },
  });

  if (stageChanged) {
    const recipientIds = new Set<string>();
    const assignedId = (updates.assignedToId ?? existing.assignedToId) as string | null;
    if (assignedId && assignedId !== actor.$id) {
      recipientIds.add(assignedId);
    }
    const tlIds = await getResumeTeamLeadIds(databases);
    tlIds.forEach((id) => {
      if (id !== actor.$id) recipientIds.add(id);
    });

    if (recipientIds.size > 0) {
      await createNotificationsForRecipients(
        databases,
        Array.from(recipientIds),
        {
          title: 'Resume Profile Stage Updated',
          body: `${actor.name} moved ${existing.candidateName} from "${existing.stage}" to "${updates.stage}".`,
          targetId: input.$id,
          targetType: 'resume_profile',
          type: 'resume_stage_updated',
        }
      );
    }
  }

  revalidatePath('/resume');
  revalidatePath(`/resume/${input.$id}`);
  return updated as unknown as ResumeProfileDocument;
}

/**
 * Delete a Resume Profile.
 */
export async function deleteResumeProfileAction(id: string): Promise<void> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    throw new Error('Not authorized to delete resume profiles');
  }

  if (actor.role !== 'admin' && actor.role !== 'developer' && actor.role !== 'team_lead') {
    throw new Error('Only team leads, developers, and admins can delete resume profiles');
  }

  const { databases } = await createAdminClient();
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, id);

  await logAuditAction(databases, {
    action: 'resume_profile.deleted',
    actorId: actor.$id,
    actorName: actor.name,
    targetId: id,
  });

  revalidatePath('/resume');
}

/**
 * Promote a Resume Profile to the Marketing page.
 *
 * Mirrors how closing a lead surfaces it on the Client page: no new record is
 * created, we just flip a flag (`movedToMarketing`) that the Marketing view
 * filters on. The button that calls this is disabled in the UI until the
 * profile reaches the '4. Marketing' stage; we re-check that here so the guard
 * cannot be bypassed. Idempotent — moving an already-moved profile is a no-op.
 */
export async function moveResumeProfileToMarketingAction(id: string): Promise<ResumeProfileDocument> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    throw new Error('Not authorized to move resume profiles to marketing');
  }

  const { databases } = await createAdminClient();
  const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.RESUME_PROFILES, id);

  if (existing.movedToMarketing) {
    return existing as unknown as ResumeProfileDocument;
  }

  if (existing.stage !== '4. Marketing') {
    throw new Error('A profile can only be moved to marketing from the "4. Marketing" stage.');
  }

  const now = new Date().toISOString();
  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    id,
    {
      movedToMarketing: true,
      marketingMovedAt: now,
      updatedAt: now,
    },
  );

  await logAuditAction(databases, {
    action: 'resume_profile.moved_to_marketing',
    actorId: actor.$id,
    actorName: actor.name,
    targetId: id,
    metadata: { candidateName: existing.candidateName },
  });

  const recipientIds = new Set<string>();
  if (existing.assignedToId && existing.assignedToId !== actor.$id) {
    recipientIds.add(existing.assignedToId as string);
  }
  const tlIds = await getResumeTeamLeadIds(databases);
  tlIds.forEach((tlId) => {
    if (tlId !== actor.$id) recipientIds.add(tlId);
  });

  if (recipientIds.size > 0) {
    await createNotificationsForRecipients(
      databases,
      Array.from(recipientIds),
      {
        title: 'Resume Profile Moved to Marketing',
        body: `${actor.name} moved ${existing.candidateName} to Marketing.`,
        targetId: id,
        targetType: 'resume_profile',
        type: 'resume_moved_to_marketing',
      }
    );
  }

  revalidatePath('/resume');
  revalidatePath(`/resume/${id}`);
  revalidatePath('/resume-marketing');
  return updated as unknown as ResumeProfileDocument;
}

/**
 * List Resume Profiles that have been moved to Marketing.
 *
 * Same scoping as listResumeProfilesAction: resume agents see only profiles
 * assigned to them; resume TLs and leadership see all. Only rows where
 * `movedToMarketing` is true are returned.
 */
export async function listMarketingProfilesAction(): Promise<ResumeProfileDocument[]> {
  try {
    const actor = await getAuthenticatedUserDoc();
    if (!actor || !isResumeSide(actor)) {
      return [];
    }

    const { databases } = await createAdminClient();
    const dept = (actor as unknown as { department?: string }).department;
    const queries: string[] = [Query.equal('movedToMarketing', true)];

    if (actor.role === 'agent' && dept === 'resume') {
      queries.push(Query.equal('assignedToId', actor.$id));
    }

    const docs = await listAllDocuments<ResumeProfileDocument>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.RESUME_PROFILES,
      queries,
      pageLimit: 100,
      maxPages: 50,
    });

    return [...docs].sort(
      (a, b) =>
        new Date(b.marketingMovedAt || b.updatedAt || (b as any).$createdAt || 0).getTime() -
        new Date(a.marketingMovedAt || a.updatedAt || (a as any).$createdAt || 0).getTime(),
    );
  } catch (error) {
    console.error('listMarketingProfilesAction error:', error);
    return [];
  }
}
