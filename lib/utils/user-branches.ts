import type { User } from '@/lib/types';

type BranchUser = Pick<User, 'branchIds' | 'primaryBranchId' | 'branchId'>;

export function getUserBranchIds(user: BranchUser): string[] {
  return [...new Set((user.branchIds?.length ? user.branchIds : user.branchId ? [user.branchId] : []).filter(Boolean))];
}

export function getPrimaryBranchId(user: BranchUser): string | null {
  const ids = getUserBranchIds(user);
  return user.primaryBranchId && ids.includes(user.primaryBranchId) ? user.primaryBranchId : ids[0] || null;
}

/** Keep the primary first for older readers while persisting every membership. */
export function normalizeUserBranches(branchIds: string[], primaryBranchId?: string | null) {
  const ids = [...new Set(branchIds.map(id => id.trim()).filter(Boolean))];
  if (primaryBranchId && !ids.includes(primaryBranchId)) throw new Error('Primary branch must be one of the selected branches.');
  const primary = primaryBranchId || ids[0] || null;
  return { branchIds: primary ? [primary, ...ids.filter(id => id !== primary)] : ids,
    primaryBranchId: primary };
}
