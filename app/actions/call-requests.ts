'use server';

import { revalidatePath } from 'next/cache';
import { ID, Query, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { REQUIRED_DOCUMENTS } from '@/lib/constants/call-request-documents';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAppwriteErrorMessage } from '@/lib/server/appwrite-errors';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import type {
  CallRequest,
  CallRequestChatMessage,
  CallRequestChecklistItem,
  CallRequestStatus,
  User,
} from '@/lib/types';
import { isValidCallRequestStatus } from '@/lib/types';
import { getResumeTeamLeads, getResumeTeamLeadIds, isResumeSide } from '@/lib/utils/resume-helpers';
export { getResumeTeamLeads, getResumeTeamLeadIds };

type CallRequestDocument = CallRequest & { $id: string };

const STATUS_LABELS: Record<CallRequestStatus, string> = {
  not_called: 'Not called',
  pending_documents: 'Pending Documents',
  call_done: 'Call done',
};

export type CallRequestUserOption = Pick<User, '$id' | 'name' | 'email'>;

// ─── Audit helper (mirrors app/actions/chat.ts) ──────────────────────────────
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
      targetType: 'call_request',
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      performedAt: new Date().toISOString(),
    });
  } catch {
    return;
  }
}

function parseChat(raw: string | null | undefined): CallRequestChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CallRequestChatMessage[]) : [];
  } catch {
    return [];
  }
}

function truncateBody(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`;
}

// A pseudo-random-free id: chat messages are already ordered by createdAt and
// scoped to a single document, so a timestamp + index-free suffix is enough to
// key them in React. Math.random is avoided (unavailable in some runtimes).
function makeMessageId(existingCount: number) {
  return `m_${Date.now().toString(36)}_${existingCount}`;
}

function canManageCallRequests(user: User): boolean {
  const dept = (user as unknown as { department?: string }).department;
  if (
    user.role === 'admin' ||
    user.role === 'developer' ||
    user.role === 'monitor' ||
    user.role === 'operations'
  ) {
    return true;
  }
  return dept === 'resume';
}

async function getCallRequestDocument(databases: Databases, requestId: string) {
  try {
    return (await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.CALL_REQUESTS,
      requestId,
    )) as unknown as CallRequestDocument;
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── Create (Sales side) ─────────────────────────────────────────────────────
export async function createCallRequestAction(input: {
  leadId: string;
  clientName: string;
  documentsChecklist: CallRequestChecklistItem[];
}) {
  const actor = await getAuthenticatedUserDoc();

  // Only Sales agents / team leads raise call requests. Leadership may too.
  const dept = (actor as unknown as { department?: string }).department;
  const isLeadership =
    actor.role === 'admin' ||
    actor.role === 'developer' ||
    actor.role === 'monitor' ||
    actor.role === 'operations';
  if (!isLeadership && dept !== 'sales') {
    throw new Error('Only Sales team members can raise call requests.');
  }
  if (!isLeadership && actor.role !== 'agent' && actor.role !== 'team_lead') {
    throw new Error('You are not allowed to raise call requests.');
  }

  if (!input.leadId) {
    throw new Error('A client is required.');
  }

  // Validate the checklist against the required-documents source of truth:
  // every required document must be present and confirmed.
  const confirmedKeys = new Set(
    (input.documentsChecklist ?? []).filter((d) => d.confirmed).map((d) => d.key),
  );
  const missing = REQUIRED_DOCUMENTS.filter((d) => !confirmedKeys.has(d.key));
  if (missing.length > 0) {
    throw new Error(
      `Please confirm all documents before requesting: ${missing
        .map((d) => d.label)
        .join(', ')}`,
    );
  }

  const { databases } = await createAdminClient();
  const now = new Date().toISOString();

  const snapshot: CallRequestChecklistItem[] = REQUIRED_DOCUMENTS.map((d) => ({
    key: d.key,
    label: d.label,
    confirmed: true,
  }));

  // New requests default-assign to a Resume Team Lead. The TL can later
  // reassign to any resume agent from the Calls page. If there's more than
  // one resume TL, the first (alphabetical by name) owns it by default.
  const resumeTeamLeads = await getResumeTeamLeads(databases);
  const defaultAssignee =
    [...resumeTeamLeads].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;

  try {
    const doc = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.CALL_REQUESTS,
      ID.unique(),
      {
        leadId: input.leadId,
        clientName: input.clientName || 'Client',
        status: 'not_called' as CallRequestStatus,
        requestedById: actor.$id,
        requestedByName: actor.name,
        assignedToId: defaultAssignee?.$id ?? null,
        assignedToName: defaultAssignee?.name ?? null,
        documentsChecklist: JSON.stringify(snapshot),
        chat: JSON.stringify([]),
        createdAt: now,
        updatedAt: now,
      },
    );

    await logAuditAction(databases, {
      action: 'CALL_REQUEST_CREATE',
      actorId: actor.$id,
      actorName: actor.name,
      targetId: doc.$id,
      metadata: { leadId: input.leadId, clientName: input.clientName },
    });

    // Notify all Resume Team Leads that a new call request arrived.
    const resumeTeamLeadIds = await getResumeTeamLeadIds(databases);
    await createNotificationsForRecipients(databases, resumeTeamLeadIds, {
      type: 'call_request_created',
      title: 'New call request',
      body: `${actor.name} requested a call for ${input.clientName || 'a client'}.`,
      targetType: 'call_request',
      targetId: doc.$id,
    });

    revalidatePath('/call-requests');
    revalidatePath('/request-calls');
    return JSON.parse(JSON.stringify(doc)) as CallRequest;
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── List (Resume side) ──────────────────────────────────────────────────────
export async function listCallRequestsAction(): Promise<CallRequest[]> {
  const actor = await getAuthenticatedUserDoc();
  if (!canManageCallRequests(actor)) {
    throw new Error('You are not allowed to view call requests.');
  }

  const { databases } = await createAdminClient();
  try {
    const all = await listAllDocuments<CallRequestDocument>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.CALL_REQUESTS,
      queries: [Query.orderDesc('$createdAt')],
      pageLimit: 100,
      maxPages: 200,
    });

    // Resume Team Leads and leadership see everything. A plain resume user
    // sees requests assigned to them plus still-unassigned ones (so they can
    // self-pick up if the TL allows it via the UI).
    const isLeadership =
      actor.role === 'admin' ||
      actor.role === 'developer' ||
      actor.role === 'monitor' ||
      actor.role === 'operations';
    if (isLeadership || actor.role === 'team_lead') {
      return all;
    }
    return all.filter((r) => !r.assignedToId || r.assignedToId === actor.$id);
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── List my own requests (Sales side) ───────────────────────────────────────
export async function listMyCallRequestsAction(): Promise<CallRequest[]> {
  const actor = await getAuthenticatedUserDoc();
  const { databases } = await createAdminClient();
  try {
    return await listAllDocuments<CallRequestDocument>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.CALL_REQUESTS,
      queries: [
        Query.equal('requestedById', actor.$id),
        Query.orderDesc('$createdAt'),
      ],
      pageLimit: 100,
      maxPages: 50,
    });
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── Assignment options (resume users) ───────────────────────────────────────
export async function getCallRequestOptionsAction(): Promise<CallRequestUserOption[]> {
  const actor = await getAuthenticatedUserDoc();
  if (!canManageCallRequests(actor)) {
    throw new Error('You are not allowed to view call requests.');
  }
  const { databases } = await createAdminClient();
  const users = await listAllDocuments<User>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [],
    pageLimit: 100,
    maxPages: 200,
  });
  return users
    .filter((u) => u.isActive !== false)
    .filter((u) => (u as unknown as { department?: string }).department === 'resume')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ $id: u.$id, name: u.name, email: u.email }));
}

// ─── Assign to a resume user ─────────────────────────────────────────────────
export async function assignCallRequestAction(input: {
  requestId: string;
  assignedToId: string;
}) {
  const actor = await getAuthenticatedUserDoc();
  // Only resume TL / leadership assign.
  const isLeadership =
    actor.role === 'admin' ||
    actor.role === 'developer' ||
    actor.role === 'monitor' ||
    actor.role === 'operations';
  if (!isLeadership && actor.role !== 'team_lead') {
    throw new Error('Only the Resume team lead can assign call requests.');
  }
  if (!isResumeSide(actor)) {
    throw new Error('Only the Resume team can assign call requests.');
  }

  const { databases } = await createAdminClient();
  const request = await getCallRequestDocument(databases, input.requestId);

  const assignee = (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.USERS,
    input.assignedToId,
  )) as unknown as User;

  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.CALL_REQUESTS, request.$id, {
      assignedToId: assignee.$id,
      assignedToName: assignee.name,
      updatedAt: new Date().toISOString(),
    });

    await logAuditAction(databases, {
      action: 'CALL_REQUEST_ASSIGN',
      actorId: actor.$id,
      actorName: actor.name,
      targetId: request.$id,
      metadata: { assignedToId: assignee.$id, assignedToName: assignee.name },
    });

    // Notify the assignee, plus the resume TLs for visibility.
    const resumeTeamLeadIds = await getResumeTeamLeadIds(databases);
    await createNotificationsForRecipients(
      databases,
      [assignee.$id, ...resumeTeamLeadIds],
      {
        type: 'call_request_assigned',
        title: 'Call request assigned',
        body: `${actor.name} assigned a call for ${request.clientName} to ${assignee.name}.`,
        targetType: 'call_request',
        targetId: request.$id,
      },
    );

    revalidatePath('/call-requests');
    return { requestId: request.$id };
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── Status change ───────────────────────────────────────────────────────────
export async function updateCallRequestStatusAction(input: {
  requestId: string;
  status: CallRequestStatus;
}) {
  const actor = await getAuthenticatedUserDoc();
  if (!canManageCallRequests(actor)) {
    throw new Error('Only the Resume team can update call status.');
  }
  if (!isValidCallRequestStatus(input.status)) {
    throw new Error('Invalid status.');
  }

  const { databases } = await createAdminClient();
  const request = await getCallRequestDocument(databases, input.requestId);

  const label = STATUS_LABELS[input.status];
  const chat = parseChat(request.chat);
  // Append a system line so the conversation reflects the status change — this
  // is what makes "after close it's sharing in the chatting section" work.
  chat.push({
    id: makeMessageId(chat.length),
    team: 'system',
    senderId: actor.$id,
    senderName: actor.name,
    body: `Status changed to "${label}".`,
    createdAt: new Date().toISOString(),
  });

  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.CALL_REQUESTS, request.$id, {
      status: input.status,
      chat: JSON.stringify(chat),
      updatedAt: new Date().toISOString(),
    });

    await logAuditAction(databases, {
      action: 'CALL_REQUEST_STATUS',
      actorId: actor.$id,
      actorName: actor.name,
      targetId: request.$id,
      metadata: { status: input.status, clientName: request.clientName },
    });

    const resumeTeamLeadIds = await getResumeTeamLeadIds(databases);

    // On "Pending Documents", pop a reminder to BOTH sides: the Sales
    // requester (share the missing docs) and the Resume side (assignee + TLs).
    if (input.status === 'pending_documents') {
      const recipients = [
        request.requestedById,
        request.assignedToId ?? null,
        ...resumeTeamLeadIds,
      ];
      await createNotificationsForRecipients(databases, recipients, {
        type: 'call_request_pending_docs',
        title: 'Documents pending',
        body: `${request.clientName}: documents are pending. Please share the required documents / a reminder mail.`,
        targetType: 'call_request',
        targetId: request.$id,
      });
    } else {
      // Every status change still pings the resume TLs for the audit trail.
      await createNotificationsForRecipients(databases, resumeTeamLeadIds, {
        type: 'call_request_status',
        title: 'Call status updated',
        body: `${request.clientName}: status changed to "${label}".`,
        targetType: 'call_request',
      });


    }

    revalidatePath('/call-requests');
    revalidatePath('/request-calls');
    revalidatePath('/resume');
    return { requestId: request.$id, status: input.status };
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

// ─── Post a chat message (either side) ───────────────────────────────────────
export async function postCallRequestMessageAction(input: {
  requestId: string;
  body: string;
}) {
  const actor = await getAuthenticatedUserDoc();
  const body = input.body.trim();
  if (!body) {
    throw new Error('Message is required.');
  }

  const { databases } = await createAdminClient();
  const request = await getCallRequestDocument(databases, input.requestId);

  // Only the two legitimate parties may post: the Sales requester who raised
  // the request, or a Resume-side user (assignee / TL / leadership).
  const isRequester = actor.$id === request.requestedById;
  if (!isRequester && !isResumeSide(actor)) {
    throw new Error('You are not allowed to post in this chat.');
  }

  // Sender's side: the requester is Sales; everyone else acting on the request
  // is Resume. Leadership posting is tagged by their department where set.
  const dept = (actor as unknown as { department?: string }).department;
  const team: CallRequestChatMessage['team'] =
    isRequester || dept === 'sales' ? 'sales' : 'resume';

  const chat = parseChat(request.chat);
  chat.push({
    id: makeMessageId(chat.length),
    team,
    senderId: actor.$id,
    senderName: actor.name,
    body,
    createdAt: new Date().toISOString(),
  });

  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.CALL_REQUESTS, request.$id, {
      chat: JSON.stringify(chat),
      updatedAt: new Date().toISOString(),
    });

    await logAuditAction(databases, {
      action: 'CALL_REQUEST_MESSAGE',
      actorId: actor.$id,
      actorName: actor.name,
      targetId: request.$id,
      metadata: { team, bodyLength: body.length },
    });

    // Notify the other side so their bell + browser popup fires.
    let recipients: Array<string | null>;
    if (team === 'sales') {
      const resumeTeamLeadIds = await getResumeTeamLeadIds(databases);
      recipients = [request.assignedToId ?? null, ...resumeTeamLeadIds];
    } else {
      recipients = [request.requestedById];
    }
    await createNotificationsForRecipients(databases, recipients, {
      type: 'call_request_message',
      title: `New message · ${request.clientName}`,
      body: `${actor.name}: ${truncateBody(body)}`,
      targetType: 'call_request',
      targetId: request.$id,
    });

    revalidatePath('/call-requests');
    revalidatePath('/request-calls');
    return chat[chat.length - 1];
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

export async function createProfileFromCallRequestAction(requestId: string) {
  const actor = await getAuthenticatedUserDoc();
  if (!canManageCallRequests(actor)) {
    throw new Error('Only the Resume team can create a profile from call requests.');
  }

  const { databases } = await createAdminClient();
  const request = await getCallRequestDocument(databases, requestId);

  const existingProfiles = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    [Query.equal('callRequestId', request.$id), Query.limit(1)]
  );
  
  if (existingProfiles.total > 0) {
    throw new Error('A Resume Profile has already been created for this call request.');
  }

  const now = new Date().toISOString();
  const createdProfile = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    ID.unique(),
    {
      callRequestId: request.$id,
      leadId: request.leadId ?? null,
      candidateName: request.clientName,
      stage: '1. Draft',
      assignedToId: request.assignedToId ?? actor.$id,
      assignedToName: request.assignedToName ?? actor.name,
      createdBy: actor.$id,
      createdByName: actor.name,
      createdAt: now,
      stageUpdatedAt: now,
    }
  );

  const resumeTeamLeadIds = await getResumeTeamLeadIds(databases);
  const recipients = [
    request.assignedToId ?? actor.$id,
    ...resumeTeamLeadIds,
  ];
  await createNotificationsForRecipients(databases, recipients, {
    type: 'resume_profile_created',
    title: 'Sent to Resume Profiles',
    body: `${request.clientName} call completed and moved to Resume Profiles page (Stage: 1. Draft).`,
    targetType: 'resume_profile',
    targetId: createdProfile.$id,
  });

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.CALL_REQUESTS,
    request.$id,
    {
      status: 'call_done',
      resumeProfileId: createdProfile.$id,
      updatedAt: new Date().toISOString(),
    }
  );

  revalidatePath('/call-requests');
  revalidatePath('/request-calls');
  revalidatePath('/resume');
  
  return JSON.parse(JSON.stringify(createdProfile));
}
