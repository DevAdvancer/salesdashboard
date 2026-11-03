import type { Lead, User } from '@/lib/types';
import { getPrimaryBranchId, getUserBranchIds } from '@/lib/utils/user-branches';

export function resolveLeadClosingBranch(owner: Pick<User, 'branchIds' | 'branchId' | 'primaryBranchId'>,
  lead: Pick<Lead, 'branchId'>, selected?: string): string | null {
  const branches = getUserBranchIds(owner);
  if (selected !== undefined && selected !== '') {
    if (!branches.includes(selected)) throw new Error('Choose one of the lead owner’s assigned branches.');
    return selected;
  }
  if (branches.length > 1) throw new Error('Choose the branch to credit before closing this lead.');
  return getPrimaryBranchId(owner) || lead.branchId || null;
}

/** Legacy branch copies are not evidence of an explicit closing choice. */
export function paymentReportingBranch(closure: { branchId?: string | null; branchSource?: string } | undefined,
  ownerPrimaryBranch: string | null | undefined): string | null {
  return closure?.branchSource === 'selected' && closure.branchId ? closure.branchId : ownerPrimaryBranch || null;
}
