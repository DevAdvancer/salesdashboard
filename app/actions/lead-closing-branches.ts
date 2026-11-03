'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { getUserBranchIds, getPrimaryBranchId } from '@/lib/utils/user-branches';
import { assertLeadAccessAllowed } from '@/lib/actions/lead/visibility';
import type { Branch, Lead, User } from '@/lib/types';

export async function getLeadClosingBranchesAction(leadId: string) {
  const actor = await getAuthenticatedUserDoc();
  const { databases } = await createAdminClient();
  const reads = databases.uncachedReads ?? databases;
  const lead = await reads.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId) as unknown as Lead;
  if (actor.role === 'agent' && lead.ownerId !== actor.$id && lead.assignedToId !== actor.$id) throw new Error('Permission denied');
  if (actor.role === 'monitor' && (lead.ownerId === actor.$id || lead.assignedToId === actor.$id)) { /* Existing monitor close access. */ }
  else await assertLeadAccessAllowed(actor, lead, databases);
  const owner = lead.ownerId === actor.$id ? actor : await reads.getDocument(DATABASE_ID, COLLECTIONS.USERS, lead.ownerId) as unknown as User;
  const ids = getUserBranchIds(owner);
  const branches = await Promise.all(ids.map(id => reads.getDocument(DATABASE_ID, COLLECTIONS.BRANCHES, id) as unknown as Promise<Branch>));
  return { ownerId: lead.ownerId, branchCount: ids.length, primaryBranchId: getPrimaryBranchId(owner),
    branches: branches.filter(branch => branch.isActive !== false).map(branch => ({ $id: branch.$id, name: branch.name, isActive: branch.isActive })) };
}
