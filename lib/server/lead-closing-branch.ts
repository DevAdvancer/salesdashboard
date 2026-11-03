import type { Lead, User } from '@/lib/types';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { resolveLeadClosingBranch } from '@/lib/utils/lead-closing-branch';
import type { createAdminClient } from '@/lib/server/appwrite';

export async function checkedLeadClosingBranch(databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], actor: User, lead: Lead, selected?: string) {
  const reads = databases.uncachedReads ?? databases;
  const owner = lead.ownerId === actor.$id ? actor : await reads.getDocument(DATABASE_ID, COLLECTIONS.USERS, lead.ownerId) as unknown as User;
  const branchId = resolveLeadClosingBranch(owner, lead, selected);
  if (branchId) {
    const branch = await (databases.uncachedReads ?? databases).getDocument(DATABASE_ID, COLLECTIONS.BRANCHES, branchId);
    if (!branch || branch.isActive === false) throw new Error('Choose an active assigned branch before closing this lead.');
  }
  return branchId;
}
