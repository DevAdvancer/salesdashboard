'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { TechnicalPayment, User } from '@/lib/types';

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

/**
 * Write a new technical payment record after an email was sent successfully.
 * Only writes — caller is responsible for only calling this when email succeeds.
 */
export async function saveTechnicalPayment(input: {
  actorId: string;
  leadId: string;
  amount: number;
  type: 'assessment' | 'interview';
}): Promise<TechnicalPayment> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, 'technical-payments');

  const { databases } = await createAdminClient();

  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.TECHNICAL_PAYMENTS,
    ID.unique(),
    {
      leadId: input.leadId,
      userId: input.actorId,
      amount: Number(input.amount) || 0,
      type: input.type,
      createdAt: new Date().toISOString(),
    },
  );

  return {
    $id: doc.$id,
    leadId: doc.leadId,
    userId: doc.userId,
    amount: Number(doc.amount) || 0,
    type: doc.type as 'assessment' | 'interview',
    createdAt: doc.createdAt,
  };
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

async function listAllTechnicalPayments(): Promise<any[]> {
  const { databases } = await createAdminClient();
  return listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [],
    pageLimit: 100,
    maxPages: 500,
  });
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

async function listTechnicalPaymentsByLeadIds(leadIds: string[]): Promise<any[]> {
  if (!leadIds.length) return [];
  const { databases } = await createAdminClient();
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    chunks.push(leadIds.slice(i, i + CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      databases.listDocuments(DATABASE_ID, COLLECTIONS.TECHNICAL_PAYMENTS, [
        Query.equal('leadId', chunk),
        Query.orderDesc('createdAt'),
        Query.limit(5000),
      ])
    )
  );
  return results.flatMap((r) => r.documents);
}

/**
 * Returns a { userId -> total } map for the given date range,
 * scoped to the actor's accessible users.
 */
export async function getTechnicalPaymentTotalsByUserAction(input: {
  actorId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Record<string, number>> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, 'technical-payments');

  const { databases } = await createAdminClient();

  // Build the actor's accessible user list
  let scopedUserIds: string[];

  if (actor.role === 'team_lead') {
    const agents = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [
        Query.equal('teamLeadId', actor.$id),
        Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
        Query.orderAsc('$id'),
      ],
      pageLimit: 100,
      maxPages: 100,
    });
    scopedUserIds = [actor.$id, ...agents.map((a: any) => a.$id)];
  } else {
    scopedUserIds = [actor.$id];
  }

  const payments = await listTechnicalPaymentsByUserIds(scopedUserIds);

  const totals: Record<string, number> = {};
  for (const doc of payments) {
    const userId = doc.userId as string;
    if (!scopedUserIds.includes(userId)) continue;
    const createdAt = typeof doc.createdAt === 'string' ? doc.createdAt : '';
    if (input.dateFrom && createdAt < input.dateFrom) continue;
    if (input.dateTo && createdAt > input.dateTo) continue;
    const amount = Number(doc.amount) || 0;
    if (amount > 0) {
      totals[userId] = (totals[userId] ?? 0) + amount;
    }
  }

  return totals;
}

export interface TechnicalPaymentSummary {
  $id: string;
  leadId: string;
  userId: string;
  userName: string;
  amount: number;
  type: 'assessment' | 'interview';
  createdAt: string;
  leadName: string;
  leadEmail: string;
}

/**
 * Full detail listing for the Technical Payments page.
 * Admin/monitor/operations see everything; team_leads see their own + team agents.
 */
export async function listTechnicalPaymentsAction(
  actorId: string
): Promise<TechnicalPaymentSummary[]> {
  const actor = await getActor(actorId);
  ensureComponentAccess(actor.role, 'technical-payments');

  const { databases } = await createAdminClient();

  // Resolve scoped user IDs
  let scopedUserIds: string[] | null;

  if (actor.role === 'team_lead') {
    const agents = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [
        Query.equal('teamLeadId', actor.$id),
        Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
        Query.orderAsc('$id'),
      ],
      pageLimit: 100,
      maxPages: 100,
    });
    scopedUserIds = [actor.$id, ...agents.map((a: any) => a.$id)];
  } else if (actor.role === 'admin' || actor.role === 'developer' || actor.role === 'monitor' || actor.role === 'operations') {
    // Admin-like roles see all payments across all users — no userId filter
    scopedUserIds = null;
  } else {
    scopedUserIds = [actor.$id];
  }

  const payments = scopedUserIds
    ? await listTechnicalPaymentsByUserIds(scopedUserIds)
    : await listAllTechnicalPayments();

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
    scopedUserIds
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.USERS,
          queries: [Query.equal('$id', scopedUserIds)],
          pageLimit: 100,
          maxPages: 100,
        })
      : await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.USERS,
          queries: [Query.orderAsc('$id')],
          pageLimit: 100,
          maxPages: 500,
        });

  const userNameMap = new Map<string, string>(
    userDocs.map((u: any) => [u.$id, u.name as string || u.$id])
  );

  const results: TechnicalPaymentSummary[] = [];
  for (const doc of payments) {
    const userId = doc.userId as string;
    if (scopedUserIds && !scopedUserIds.includes(userId)) continue;
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

/**
 * Get technical payment summaries for specific leads — used by reports.
 * Returns all records for the given leadIds, regardless of which user created them.
 */
export async function getTechnicalPaymentsByLeadIdsAction(
  actorId: string,
  leadIds: string[]
): Promise<TechnicalPayment[]> {
  const actor = await getActor(actorId);
  ensureComponentAccess(actor.role, 'technical-payments');

  if (!leadIds.length) return [];

  const docs = await listTechnicalPaymentsByLeadIds(leadIds);
  return docs.map((doc) => ({
    $id: doc.$id,
    leadId: doc.leadId as string,
    userId: doc.userId as string,
    amount: Number(doc.amount) || 0,
    type: doc.type as 'assessment' | 'interview',
    createdAt: doc.createdAt as string,
  }));
}
