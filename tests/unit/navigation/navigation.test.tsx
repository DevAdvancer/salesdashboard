import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Navigation } from '@/components/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess } from '@/lib/contexts/access-control-context';
import { useRouter, usePathname } from 'next/navigation';

// Mock the contexts and hooks
jest.mock('@/lib/contexts/auth-context');
jest.mock('@/lib/contexts/access-control-context');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseAccess = useAccess as jest.MockedFunction<typeof useAccess>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe('Navigation Component', () => {
  const mockPush = jest.fn();
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({ push: mockPush } as any);
    mockUsePathname.mockReturnValue('/dashboard');
  });

  describe('Agent sees only permitted components', () => {
    it('should show only dashboard and leads for agent with limited access', () => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: 'agent-1',
          name: 'Test Agent',
          email: 'agent@test.com',
          role: 'agent',
          managerId: 'manager-1',
        },
        isManager: false,
        isAgent: true,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: (componentKey: string) => {
          return componentKey === 'dashboard' || componentKey === 'leads';
        },
        loading: false,
      } as any);

      render(<Navigation />);

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.queryByText('History')).not.toBeInTheDocument();
      expect(screen.queryByText('User Management')).not.toBeInTheDocument();
      expect(screen.queryByText('Field Management')).not.toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });
  });

  describe('Manager sees all components', () => {
    it('should show all navigation items for manager', () => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: 'manager-1',
          name: 'Test Manager',
          email: 'manager@test.com',
          role: 'manager',
          managerId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);

      render(<Navigation />);

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.getByText('History')).toBeInTheDocument();
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Field Management')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Navigation links work correctly', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: 'user-1',
          name: 'Test User',
          email: 'user@test.com',
          role: 'manager',
          managerId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);
    });

    it('should navigate to dashboard when dashboard link is clicked', () => {
      render(<Navigation />);
      const dashboardLink = screen.getByText('Dashboard');
      fireEvent.click(dashboardLink);
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    it('should navigate to leads when leads link is clicked', () => {
      render(<Navigation />);
      const leadsLink = screen.getByText('Leads');
      fireEvent.click(leadsLink);
      expect(mockPush).toHaveBeenCalledWith('/leads');
    });

    it('should highlight active route', () => {
      mockUsePathname.mockReturnValue('/leads');
      render(<Navigation />);
      const leadsLink = screen.getByText('Leads').closest('button');
      expect(leadsLink).toHaveClass('bg-primary');
    });
  });

  describe('Logout clears session', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: 'user-1',
          name: 'Test User',
          email: 'user@test.com',
          role: 'manager',
          managerId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);
    });

    it('should call logout and redirect to login when logout button is clicked', async () => {
      mockLogout.mockResolvedValue(undefined);
      render(<Navigation />);
      const logoutButton = screen.getByText('Log out');
      fireEvent.click(logoutButton);
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });
});
