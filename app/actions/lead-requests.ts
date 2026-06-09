'use server';

import { revalidatePath } from 'next/cache';
import { Databases, ID, Query } from 'node-appwrite';
import { createLeadAction } from '@/app/actions/lead';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAppwriteErrorMessage } from '@/lib/server/appwrite-errors';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import type { Branch, Lead, LeadRequest, User } from '@/lib/types';
import {
  buildLeadRequestLeadData,
  findLeadRequestDuplicateWarnings,
  formatLeadRequestDuplicateMessage,
  normalizeDuplicateFieldValue,
  normalizePublicLeadRequestInput,
  type PublicLeadRequestInput,
} from '@/lib/utils/lead-requests';

type LeadRequestDocument = LeadRequest & {
  $id: string;
};

export type LeadRequestAdminOptions = {
  users: Array<Pick<User, '$id' | 'name' | 'email' | 'role'>>;
  branches: Array<Pick<Branch, '$id' | 'name'>>;
};

export async function createPublicLeadRequestAction(input: PublicLeadRequestInput) {
  const normalized = normalizePublicLeadRequestInput(input);

  if (!normalized.firstName) {
    throw new Error('First name is required.');
  }

  if (!normalized.lastName) {
    throw new Error('Last name is required.');
  }

  if (!normalized.email) {
    throw new Error('Email is required.');
  }

  if (!normalized.phone) {
    throw new Error('Phone is required.');
  }

  if (!normalized.linkedinProfileUrl) {
    throw new Error('LinkedIn link is required.');
  }

  const { databases } = await createAdminClient();

  // Fetch all existing lead requests to check for duplicates
  const existingRequests = await listAllDocuments<LeadRequestDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEAD_REQUESTS,
    queries: [],
    pageLimit: 100,
    maxPages: 200,
  });

  const inputEmail = normalizeDuplicateFieldValue('email', normalized.email);
  const inputPhone = normalizeDuplicateFieldValue('phone', normalized.phone);
  const inputLinkedin = normalizeDuplicateFieldValue('linkedinProfileUrl', normalized.linkedinProfileUrl);

  for (const req of existingRequests) {
    if (req.status === 'rejected') continue;

    const reqEmail = normalizeDuplicateFieldValue('email', req.email);
    const reqPhone = normalizeDuplicateFieldValue('phone', req.phone);
    const reqLinkedin = normalizeDuplicateFieldValue('linkedinProfileUrl', req.linkedinProfileUrl);

    if (inputEmail && reqEmail === inputEmail) {
      throw new Error('Email is already there.');
    }
    if (inputPhone && reqPhone === inputPhone) {
      throw new Error('Phone is already there.');
    }
    if (inputLinkedin && reqLinkedin === inputLinkedin) {
      throw new Error('LinkedIn link is already there.');
    }
  }

  const now = new Date().toISOString();
  const data = JSON.stringify(buildLeadRequestLeadData(normalized, 'pending'));
  const { firstName, lastName, ...appwriteFields } = normalized;

  try {
    const request = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LEAD_REQUESTS,
      ID.unique(),
      {
        ...appwriteFields,
        data,
        status: 'pending',
        duplicateMessage: null,
        movedLeadId: null,
        movedById: null,
        movedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    return { requestId: request.$id as string };
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

export async function listLeadRequestsAction(): Promise<LeadRequest[]> {
  await assertLeadRequestReader();
  const { databases } = await createAdminClient();

  try {
    return await listAllDocuments<LeadRequestDocument>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LEAD_REQUESTS,
      queries: [Query.orderDesc('$createdAt')],
      pageLimit: 100,
      maxPages: 200,
    });
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

export async function getLeadRequestAdminOptionsAction(): Promise<LeadRequestAdminOptions> {
  await assertLeadRequestReader();
  const { databases } = await createAdminClient();

  const [users, branches] = await Promise.all([
    listAllDocuments<User>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [],
      pageLimit: 100,
      maxPages: 200,
    }),
    listAllDocuments<Branch>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.BRANCHES,
      queries: [],
      pageLimit: 100,
      maxPages: 100,
    }),
  ]);

  return {
    users: users
      .filter((user) => user.isActive !== false)
      .sort((first, second) => first.name.localeCompare(second.name))
      .map((user) => ({
        $id: user.$id,
        name: user.name,
        email: user.email,
        role: user.role,
      })),
    branches: branches
      .filter((branch) => branch.isActive !== false)
      .sort((first, second) => first.name.localeCompare(second.name))
      .map((branch) => ({
        $id: branch.$id,
        name: branch.name,
      })),
  };
}

export async function moveLeadRequestToLeadAction(input: {
  requestId: string;
  assignedToId?: string;
  branchId?: string;
}) {
  const actor = await assertLeadRequestAdmin();
  const { databases } = await createAdminClient();
  const request = await getLeadRequestDocument(databases, input.requestId);

  if (request.status === 'moved') {
    throw new Error('This request was already moved to leads.');
  }

  const normalized = normalizePublicLeadRequestInput(request);
  const existingLeads = await listAllDocuments<Lead>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [Query.orderAsc('$id')],
    pageLimit: 100,
    maxPages: 500,
  });

  const duplicateWarnings = findLeadRequestDuplicateWarnings(normalized, existingLeads);
  if (duplicateWarnings.length > 0) {
    const duplicateMessage = formatLeadRequestDuplicateMessage(duplicateWarnings);
    await updateLeadRequest(databases, request.$id, {
      duplicateMessage,
      updatedAt: new Date().toISOString(),
    });
    throw new Error(duplicateMessage);
  }

  const leadData = buildLeadRequestLeadData(normalized, request.$id);
  const lead = await createLeadAction(
    actor.$id,
    {
      data: leadData,
      assignedToId: input.assignedToId || undefined,
      branchId: input.branchId || null,
      status: 'Interested',
    },
    actor.$id,
    actor.name,
  );

  await updateLeadRequest(databases, request.$id, {
    data: JSON.stringify(leadData),
    status: 'moved',
    duplicateMessage: null,
    movedLeadId: lead.$id,
    movedById: actor.$id,
    movedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  revalidatePath('/lead-requests');
  revalidatePath('/leads');
  return { leadId: lead.$id };
}

export async function rejectLeadRequestAction(requestId: string) {
  const actor = await assertLeadRequestAdmin();
  const { databases } = await createAdminClient();
  const request = await getLeadRequestDocument(databases, requestId);

  if (request.status === 'moved') {
    throw new Error('Moved requests cannot be rejected.');
  }

  await updateLeadRequest(databases, request.$id, {
    status: 'rejected',
    duplicateMessage: null,
    movedById: actor.$id,
    updatedAt: new Date().toISOString(),
  });

  revalidatePath('/lead-requests');
  return { requestId };
}

async function assertLeadRequestAdmin() {
  const actor = await getAuthenticatedUserDoc();
  if (actor.role !== 'admin' && actor.role !== 'developer') {
    throw new Error('Only admins can manage lead requests.');
  }
  return actor;
}

async function assertLeadRequestReader() {
  const actor = await getAuthenticatedUserDoc();
  if (
    actor.role !== 'admin' &&
    actor.role !== 'developer' &&
    actor.role !== 'monitor' &&
    actor.role !== 'operations'
  ) {
    throw new Error('Only admins can view lead requests.');
  }
  return actor;
}

async function getLeadRequestDocument(databases: Databases, requestId: string) {
  try {
    return (await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.LEAD_REQUESTS,
      requestId,
    )) as unknown as LeadRequestDocument;
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

async function updateLeadRequest(
  databases: Databases,
  requestId: string,
  payload: Partial<LeadRequest>,
) {
  try {
    return databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEAD_REQUESTS,
      requestId,
      payload,
    );
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}
