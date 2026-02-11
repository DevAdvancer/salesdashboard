
import { UserRole } from '@/lib/types';

export interface BranchVisibilityCheck {
  visibleBranchIds: string[];
  hiddenBranchCount: number;
  hasVisibilityMismatch: boolean;
}

/**
 * Calculates which branches of a target user are visible to the current viewer
 * based on hierarchical access rules.
 *
 * Rules:
 * 1. Admins see all branches.
 * 2. Managers/Team Leads only see branches they are also assigned to.
 * 3. Any branches assigned to the target user but not the viewer are hidden.
 *
 * @param targetUserBranchIds - The branch IDs assigned to the user being viewed
 * @param viewerRole - The role of the current viewer (admin, manager, team_lead, agent)
 * @param viewerBranchIds - The branch IDs assigned to the current viewer
 * @param logger - Optional logger function for visibility mismatches
 * @returns Object containing visible branch IDs and mismatch info
 */
export function getVisibleUserBranches(
  targetUserBranchIds: string[],
  viewerRole: UserRole,
  viewerBranchIds: string[],
  logger?: (message: string, meta?: any) => void
): BranchVisibilityCheck {
  // 1. Admins see everything
  if (viewerRole === 'admin') {
    return {
      visibleBranchIds: [...targetUserBranchIds],
      hiddenBranchCount: 0,
      hasVisibilityMismatch: false
    };
  }

  // 2. Managers and Team Leads filter by their own assignments
  // We use a Set for efficient lookup
  const viewerBranchSet = new Set(viewerBranchIds);

  const visibleBranchIds = targetUserBranchIds.filter(id => viewerBranchSet.has(id));
  const hiddenBranchIds = targetUserBranchIds.filter(id => !viewerBranchSet.has(id));

  const hasVisibilityMismatch = hiddenBranchIds.length > 0;

  // 4. Logging for mismatches
  if (hasVisibilityMismatch && logger) {
    logger('Branch visibility mismatch detected', {
      viewerRole,
      viewerBranchCount: viewerBranchIds.length,
      targetTotalBranches: targetUserBranchIds.length,
      hiddenBranches: hiddenBranchIds,
      visibleBranches: visibleBranchIds
    });
  }

  return {
    visibleBranchIds,
    hiddenBranchCount: hiddenBranchIds.length,
    hasVisibilityMismatch
  };
}
