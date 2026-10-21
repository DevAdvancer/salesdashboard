import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { createAdminClient } from '@/lib/server/appwrite';
import type { User } from '@/lib/types';

/** Called only after the report action has authorized its viewer. */
export async function listTargetReportContributors(databases: Awaited<ReturnType<typeof createAdminClient>>['databases']) {
  const users = await listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
    queries: [Query.equal('role', ['admin', 'monitor']), Query.orderAsc('$id')],
  });
  return users.filter(user => (user.department ?? 'sales') === 'sales');
}
