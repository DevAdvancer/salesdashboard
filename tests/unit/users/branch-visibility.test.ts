
import { getVisibleUserBranches } from '@/lib/utils/branch-visibility';

describe('getVisibleUserBranches', () => {
  const mockLogger = jest.fn();

  beforeEach(() => {
    mockLogger.mockClear();
  });

  it('should allow admins to see all branches', () => {
    const targetBranches = ['branch-a', 'branch-b'];
    const result = getVisibleUserBranches(
      targetBranches,
      'admin',
      [], // Admins don't need branch assignments
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual(targetBranches);
    expect(result.hiddenBranchCount).toBe(0);
    expect(result.hasVisibilityMismatch).toBe(false);
    expect(mockLogger).not.toHaveBeenCalled();
  });

  it('should restrict managers to only their assigned branches', () => {
    const targetBranches = ['branch-a', 'branch-b', 'branch-c'];
    const viewerBranches = ['branch-a', 'branch-c'];

    const result = getVisibleUserBranches(
      targetBranches,
      'manager',
      viewerBranches,
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual(['branch-a', 'branch-c']);
    expect(result.hiddenBranchCount).toBe(1); // branch-b is hidden
    expect(result.hasVisibilityMismatch).toBe(true);
    expect(mockLogger).toHaveBeenCalledWith(
      'Branch visibility mismatch detected',
      expect.objectContaining({
        hiddenBranches: ['branch-b']
      })
    );
  });

  it('should restrict team leads to only their assigned branches', () => {
    const targetBranches = ['branch-a', 'branch-b'];
    const viewerBranches = ['branch-b'];

    const result = getVisibleUserBranches(
      targetBranches,
      'team_lead',
      viewerBranches,
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual(['branch-b']);
    expect(result.hiddenBranchCount).toBe(1); // branch-a is hidden
    expect(result.hasVisibilityMismatch).toBe(true);
  });

  it('should show all branches when assignments are identical', () => {
    const branches = ['branch-a', 'branch-b'];

    const result = getVisibleUserBranches(
      branches,
      'manager',
      branches,
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual(branches);
    expect(result.hiddenBranchCount).toBe(0);
    expect(result.hasVisibilityMismatch).toBe(false);
    expect(mockLogger).not.toHaveBeenCalled();
  });

  it('should handle empty branch lists', () => {
    const result = getVisibleUserBranches(
      [],
      'manager',
      ['branch-a'],
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual([]);
    expect(result.hiddenBranchCount).toBe(0);
    expect(result.hasVisibilityMismatch).toBe(false);
  });

  it('should handle case where viewer has no overlapping branches', () => {
    const targetBranches = ['branch-a'];
    const viewerBranches = ['branch-b'];

    const result = getVisibleUserBranches(
      targetBranches,
      'manager',
      viewerBranches,
      mockLogger
    );

    expect(result.visibleBranchIds).toEqual([]);
    expect(result.hiddenBranchCount).toBe(1);
    expect(result.hasVisibilityMismatch).toBe(true);
  });
});
