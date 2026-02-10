/**
 * Unit tests for permission error handling
 * Requirements: 10.6, 10.7
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess } from '@/lib/contexts/access-control-context';
import { handlePermissionError } from '@/lib/utils/error-handler';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/contexts/access-control-context', () => ({
  useAccess: jest.fn(),
}));

jest.mock('@/lib/utils/error-handler', () => ({
  handlePermissionError: jest.fn(),
}));

describe('Permission Error Handling', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
  });

  it('should redirect to login when user is not authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({ user: null });
    (useAccess as jest.Mock).mockReturnValue({
      canAccess: jest.fn(),
      isLoading: false,
    });

    render(
      <ProtectedRoute componentKey="leads">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('should show permission error and redirect when access is denied', async () => {
    const mockUser = { $id: '1', role: 'agent', name: 'Test Agent', email: 'agent@test.com' };
    const mockCanAccess = jest.fn().mockReturnValue(false);

    (useAuth as jest.Mock).mockReturnValue({ user: mockUser });
    (useAccess as jest.Mock).mockReturnValue({
      canAccess: mockCanAccess,
      isLoading: false,
    });

    render(
      <ProtectedRoute componentKey="user-management">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    await waitFor(() => {
      expect(handlePermissionError).toHaveBeenCalledWith(
        expect.stringContaining('user management'),
        { showToast: true }
      );
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('should render content when user has access', () => {
    const mockUser = { $id: '1', role: 'manager', name: 'Test Manager', email: 'manager@test.com' };
    const mockCanAccess = jest.fn().mockReturnValue(true);

    (useAuth as jest.Mock).mockReturnValue({ user: mockUser });
    (useAccess as jest.Mock).mockReturnValue({
      canAccess: mockCanAccess,
      isLoading: false,
    });

    render(
      <ProtectedRoute componentKey="leads">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(handlePermissionError).not.toHaveBeenCalled();
  });

  it('should show loading state while checking permissions', () => {
    const mockUser = { $id: '1', role: 'agent', name: 'Test Agent', email: 'agent@test.com' };

    (useAuth as jest.Mock).mockReturnValue({ user: mockUser });
    (useAccess as jest.Mock).mockReturnValue({
      canAccess: jest.fn(),
      isLoading: true,
    });

    render(
      <ProtectedRoute componentKey="leads">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should redirect to custom fallback path when provided', async () => {
    const mockUser = { $id: '1', role: 'agent', name: 'Test Agent', email: 'agent@test.com' };
    const mockCanAccess = jest.fn().mockReturnValue(false);

    (useAuth as jest.Mock).mockReturnValue({ user: mockUser });
    (useAccess as jest.Mock).mockReturnValue({
      canAccess: mockCanAccess,
      isLoading: false,
    });

    render(
      <ProtectedRoute componentKey="settings" fallbackPath="/leads">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/leads');
    });
  });
});
