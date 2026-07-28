import React from 'react';
import { renderHook } from '@testing-library/react';
import { AccessControlProvider, useAccess } from '@/lib/contexts/access-control-context';
import { useAuth } from '@/lib/contexts/auth-context';

// Mock dependencies
jest.mock('@/lib/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

describe('Access Control Context', () => {
  const mockUseAuth = useAuth as jest.Mock;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AccessControlProvider>{children}</AccessControlProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Static Rules Apply Correctly', () => {
    it('should grant admin full access by default', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: 'admin-1', role: 'admin', email: 'admin@test.com' },
        isAdmin: true,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      expect(result.current.canAccess('user-management')).toBe(true);
    });

    it('should grant team_lead default access', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: 'tl-1', role: 'team_lead', email: 'tl@test.com' },
        isAdmin: false,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      // Team lead should access user management
      expect(result.current.canAccess('user-management')).toBe(true);
      // Nobody accesses field-management
      expect(result.current.canAccess('field-management')).toBe(false);
    });

    it('should return false when user is not authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAdmin: false,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      expect(result.current.canAccess('dashboard')).toBe(false);
    });
  });
});
