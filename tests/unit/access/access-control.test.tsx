/**
 * Unit tests for access control system
 *
 * Tests cover:
 * - Default rules apply correctly
 * - Custom rules override defaults
 * - Manager always has access
 * - Agent respects rules
 *
 * Requirements: 2.4, 2.5, 2.6
 */

import { databases } from '@/lib/appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
  },
}));

// Mock the auth context
const mockUseAuth = jest.fn();
jest.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

// Import after mocks are set up
import { renderHook, waitFor, act } from '@testing-library/react';
import { AccessControlProvider, useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import React from 'react';

describe('Access Control System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AccessControlProvider>{children}</AccessControlProvider>
  );

  describe('Default Rules Apply Correctly', () => {
    it('should deny agent access to all components by default when no custom rules exist', async () => {
      // Setup: Agent user with no custom rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [], // No custom rules
        total: 0,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Agents get default access to dashboard and leads only
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);

      // Agents should be denied access to other components by default
      const deniedComponents: ComponentKey[] = [
        'history',
        'user-management',
        'field-management',
        'settings',
      ];

      deniedComponents.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(false);
      });
    });

    it('should grant manager access to all components by default', async () => {
      // Setup: Manager user with no custom rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'manager-1', role: 'manager', email: 'manager@test.com' },
        isManager: true,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [], // No custom rules
        total: 0,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Test all standard components - managers should have access by default
      const components: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'field-management',
        'settings',
      ];

      components.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });
    });

    it('should return false when user is not authenticated', async () => {
      // Setup: No user
      mockUseAuth.mockReturnValue({
        user: null,
        isManager: false,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [],
        total: 0,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAccess('dashboard')).toBe(false);
      expect(result.current.canAccess('leads')).toBe(false);
    });
  });

  describe('Custom Rules Override Defaults', () => {
    it('should allow agent access when custom rule grants permission', async () => {
      // Setup: Agent user with custom rules granting access to dashboard and leads
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-3',
          componentKey: 'history',
          role: 'agent',
          allowed: false,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Custom rules should override defaults
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      expect(result.current.canAccess('history')).toBe(false);

      // Components without custom rules should use default (false for agents)
      expect(result.current.canAccess('user-management')).toBe(false);
      expect(result.current.canAccess('field-management')).toBe(false);
    });

    it('should deny agent access when custom rule explicitly denies', async () => {
      // Setup: Agent with explicit deny rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: false,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'agent',
          allowed: false,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAccess('dashboard')).toBe(false);
      expect(result.current.canAccess('leads')).toBe(false);
    });

    it('should handle mixed custom rules correctly', async () => {
      // Setup: Agent with some allowed and some denied
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-3',
          componentKey: 'history',
          role: 'agent',
          allowed: false,
        },
        {
          $id: 'rule-4',
          componentKey: 'user-management',
          role: 'agent',
          allowed: false,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Explicitly allowed
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);

      // Explicitly denied
      expect(result.current.canAccess('history')).toBe(false);
      expect(result.current.canAccess('user-management')).toBe(false);

      // No rule - default to false for agents
      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('settings')).toBe(false);
    });
  });

  describe('Manager Always Has Access', () => {
    it('should grant manager access regardless of custom rules', async () => {
      // Setup: Manager with rules that would deny access to agents
      mockUseAuth.mockReturnValue({
        user: { $id: 'manager-1', role: 'manager', email: 'manager@test.com' },
        isManager: true,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: false,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'agent',
          allowed: false,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Manager should have access to everything
      const components: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'field-management',
        'settings',
      ];

      components.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });
    });

    it('should respect explicit deny rules for managers from custom rules', async () => {
      // Setup: Manager with rules that explicitly deny manager access
      mockUseAuth.mockReturnValue({
        user: { $id: 'manager-1', role: 'manager', email: 'manager@test.com' },
        isManager: true,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'manager',
          allowed: false,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'manager',
          allowed: false,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Custom deny rules are respected for managers (only admins bypass)
      expect(result.current.canAccess('dashboard')).toBe(false);
      expect(result.current.canAccess('leads')).toBe(false);
      // Components without custom rules fall back to manager defaults (true)
      expect(result.current.canAccess('history')).toBe(true);
    });

    it('should maintain manager access after rules refresh', async () => {
      // Setup: Manager user
      mockUseAuth.mockReturnValue({
        user: { $id: 'manager-1', role: 'manager', email: 'manager@test.com' },
        isManager: true,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [],
        total: 0,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Initial check
      expect(result.current.canAccess('dashboard')).toBe(true);

      // Refresh rules
      await act(async () => {
        await result.current.refreshRules();
      });

      // Should still have access
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
    });
  });

  describe('Agent Respects Rules', () => {
    it('should respect agent-specific rules', async () => {
      // Setup: Agent with specific permissions
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'agent',
          allowed: true,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Agent should have access to allowed components
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);

      // Agent should not have access to restricted components
      expect(result.current.canAccess('user-management')).toBe(false);
      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('settings')).toBe(false);
    });

    it('should update agent access when rules change', async () => {
      // Setup: Agent with initial rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const initialRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: initialRules,
        total: initialRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Initial state
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      // history has no custom rule, defaults to false for agents
      expect(result.current.canAccess('history')).toBe(false);

      // Update rules to add history access
      const updatedRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
        {
          $id: 'rule-2',
          componentKey: 'history',
          role: 'agent',
          allowed: true,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: updatedRules,
        total: updatedRules.length,
      });

      // Refresh rules
      await act(async () => {
        await result.current.refreshRules();
      });

      // Updated state
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('history')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
    });

    it('should handle agent access consistently across multiple checks', async () => {
      // Setup: Agent with rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'agent',
          allowed: true,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: customRules,
        total: customRules.length,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Multiple checks should return consistent results
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('dashboard')).toBe(true);

      expect(result.current.canAccess('user-management')).toBe(false);
      expect(result.current.canAccess('user-management')).toBe(false);
      expect(result.current.canAccess('user-management')).toBe(false);
    });

    it('should deny agent access to sensitive components by default', async () => {
      // Setup: Agent with no custom rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [],
        total: 0,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Sensitive components should be denied by default
      expect(result.current.canAccess('user-management')).toBe(false);
      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('settings')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should fall back to default rules when database fetch fails', async () => {
      // Setup: Agent user with database error
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should fall back to default rules (agents get dashboard and leads by default)
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      // Other components denied by default for agents
      expect(result.current.canAccess('user-management')).toBe(false);
    });

    it('should maintain manager access even when database fetch fails', async () => {
      // Setup: Manager user with database error
      mockUseAuth.mockReturnValue({
        user: { $id: 'manager-1', role: 'manager', email: 'manager@test.com' },
        isManager: true,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Manager should still have access
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      expect(result.current.canAccess('user-management')).toBe(true);
    });
  });

  describe('Loading State', () => {
    it('should indicate loading state while fetching rules', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: 'agent-1', role: 'agent', email: 'agent@test.com' },
        isManager: false,
        isAdmin: false,
      });

      // Create a promise that we can control
      let resolvePromise: any;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      (databases.listDocuments as jest.Mock).mockReturnValue(promise);

      const { result } = renderHook(() => useAccess(), { wrapper });

      // Should be loading initially
      expect(result.current.isLoading).toBe(true);

      // Resolve the promise
      resolvePromise({ documents: [], total: 0 });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
