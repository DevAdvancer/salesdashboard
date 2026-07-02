'use server';

import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import type { User } from "@/lib/types";

async function getActor(userId: string): Promise<User> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();
  const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role as User['role'],
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    department: (doc.department as User['department']) || 'sales',
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

function ensureComponentAccess(role: User['role'], componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
  if (!isRoleEligibleForComponent(componentKey, role as any)) {
    throw new Error('Not authorized');
  }
}

async function listTechnicalPaymentsByUserIds(userIds: string[]): Promise<any[]> {
  if (!userIds.length) return [];
  const { databases } = await createAdminClient();
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += CHUNK) {
    chunks.push(userIds.slice(i, i + CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      databases.listDocuments(DATABASE_ID, COLLECTIONS.TECHNICAL_PAYMENTS, [
        Query.equal('userId', chunk),
        Query.orderDesc('createdAt'),
        Query.limit(5000),
      ])
    )
  );
  return results.flatMap((r) => r.documents);
}

async function listAllTechnicalPaymentsForDashboard(): Promise<any[]> {
  const { databases } = await createAdminClient();
  const all: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const response: any = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TECHNICAL_PAYMENTS, [
      Query.orderDesc('createdAt'),
      Query.limit(500),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ]);
    all.push(...response.documents);
    if (!response.documents.length) break;
    cursor = response.documents[response.documents.length - 1]?.$id ?? null;
    if (!cursor) break;
  }
  return all;
}

/**
 * Get technical payments for dashboard display.
 * Returns full details with lead and user names.
 */
export async function loadTechnicalPaymentsDashboardAction(input: {
  actorId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Array<{
  $id: string;
  leadId: string;
  userId: string;
  userName: string;
  amount: number;
  type: 'assessment' | 'interview';
  createdAt: string;
  leadName: string;
  leadEmail: string;
}>> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, 'technical-payments');

  const { databases } = await createAdminClient();

  // Resolve scoped user IDs
  let scopedUserIds: string[];

  if (actor.role === 'team_lead') {
    const agents = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('teamLeadId', actor.$id), Query.equal('role', 'agent')],
      pageLimit: 100,
      maxPages: 100,
    });
    scopedUserIds = [actor.$id, ...agents.map((a: any) => a.$id)];
  } else if (actor.role === 'admin' || actor.role === 'developer' || actor.role === 'monitor' || actor.role === 'operations') {
    // Admin-like roles see all payments across all users
    scopedUserIds = [];
  } else {
    scopedUserIds = [actor.$id];
  }

  const payments = scopedUserIds.length > 0
    ? await listTechnicalPaymentsByUserIds(scopedUserIds)
    : await listAllTechnicalPaymentsForDashboard();

  // Collect lead IDs to batch-fetch lead data
  const leadIds = Array.from(new Set(payments.map((p: any) => p.leadId).filter(Boolean)));
  const leadDocs =
    leadIds.length > 0
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.LEADS,
          queries: [Query.equal('$id', leadIds)],
          pageLimit: 100,
          maxPages: 500,
        })
      : [];

  const leadDataMap = new Map<string, { name: string; email: string }>();
  for (const lead of leadDocs) {
    try {
      const data = JSON.parse(lead.data ?? '{}') as Record<string, unknown>;
      const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
      const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
      const name = [firstName, lastName].filter(Boolean).join(' ') || data.email as string || 'Unknown';
      leadDataMap.set(lead.$id, { name, email: (data.email as string) || '' });
    } catch {
      leadDataMap.set(lead.$id, { name: 'Unknown', email: '' });
    }
  }

  const userDocs =
    scopedUserIds.length > 0
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.USERS,
          queries: [Query.equal('$id', scopedUserIds)],
          pageLimit: 100,
          maxPages: 100,
        })
      : [];

  const userNameMap = new Map<string, string>(
    userDocs.map((u: any) => [u.$id, u.name as string || u.$id])
  );

  const results = [];
  const normalizedFrom = input.dateFrom ?? "";
  const normalizedTo = input.dateTo ?? "";

  const isAdminLike = scopedUserIds.length === 0;

  for (const doc of payments) {
    const userId = doc.userId as string;

    // Apply date range filter (always needed)
    if (normalizedFrom || normalizedTo) {
      const docDate = typeof doc.createdAt === 'string' ? doc.createdAt.substring(0, 10) : '';
      if (normalizedFrom && docDate < normalizedFrom) continue;
      if (normalizedTo && docDate > normalizedTo) continue;
    }

    const leadMeta = leadDataMap.get(doc.leadId as string) ?? { name: 'Unknown', email: '' };
    results.push({
      $id: doc.$id,
      leadId: doc.leadId as string,
      userId,
      userName: userNameMap.get(userId) ?? userId,
      amount: Number(doc.amount) || 0,
      type: doc.type as 'assessment' | 'interview',
      createdAt: doc.createdAt as string,
      leadName: leadMeta.name,
      leadEmail: leadMeta.email,
    });
  }

  return results.sort(
    (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  );
}
