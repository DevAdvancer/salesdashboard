import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { createAdminClient } from '@/lib/server/appwrite';
import type { User } from '@/lib/types';

/** Reference profiles only: these extra owners must never become report contributors. */
export async function targetReportBranchOwners(databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  users: Map<string, User>, leads: Map<string, Record<string, unknown>>, payments: Record<string, unknown>[]) {
  const profiles = new Map(users);
  const ids = new Set<string>();
  for (const lead of leads.values()) if (typeof lead.ownerId === 'string') ids.add(lead.ownerId);
  for (const payment of payments) {
    try {
      const owner = JSON.parse(String(payment.paymentPlan ?? payment.paymentPlanJson ?? '{}')).closure?.ownerId;
      if (typeof owner === 'string') ids.add(owner);
    } catch { /* Legacy rows may have no snapshot. */ }
  }
  const missing = [...ids].filter(id => !profiles.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const docs = await listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('$id', missing.slice(i, i + 100)), Query.select(['$id', 'branchId', 'branchIds', 'primaryBranchId'])], requireComplete: true });
    docs.forEach(doc => profiles.set(doc.$id, doc));
  }
  return profiles;
}
