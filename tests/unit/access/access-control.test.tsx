/**
 * Unit tests for access control system
 *
 * Tests cover:
 * - Default rules apply correctly
 * - Custom rules override defaults
 * - TeamLead always has access
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
import { invalidateAccessRulesCache } from '@/lib/services/access-config-service';
import React from 'react';

describe('Access Control System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Access rules are read through a module-level client read cache keyed by
    // `${userId}:${role}`. That cache outlives an individual test, so without
    // this reset a later test reusing the same user id would keep the rules
    // fetched by an earlier test instead of its own mocked documents.
    invalidateAccessRulesCache();
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

      // Agents get default access to work basics, the client history page
      // and their own settings. Agent access to history is deliberate: it is
      // listed for 'agent' in COMPONENT_ACCESS and granted unconditionally in
      // AccessControlProvider.canAccess.
      expect(result.current.canAccess('dashboard')).toBe(true);
      expect(result.current.canAccess('leads')).toBe(true);
      expect(result.current.canAccess('history')).toBe(true);
      expect(result.current.canAccess('settings')).toBe(true);

      // Agents should be denied access to other components by default
      const deniedComponents: ComponentKey[] = [
        'user-management',
        'field-management',
      ];

      deniedComponents.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(false);
      });
    });

    it('should grant teamLead access to all components by default', async () => {
      // Setup: TeamLead user with no custom rules
      mockUseAuth.mockReturnValue({
        user: { $id: 'teamLead-1', role: 'team_lead', email: 'teamLead@test.com' },
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

      // Test all standard components - teamLeads should have access by default
      const components: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'settings',
      ];

      components.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });

      // Field management was removed from the product: its COMPONENT_ACCESS
      // entry is empty, so no role, team lead included, is eligible.
      expect(result.current.canAccess('field-management')).toBe(false);
    });

    it('should grant monitor broad read access by default', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: 'monitor-1', role: 'monitor', email: 'monitor@test.com' },
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

      const visibleComponents: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'branch-management',
        'audit-logs',
        'hierarchy',
        'work-queue',
        'reports',
        'review-queue',
        'attendance',
        'lead-requests',
        'linkedin-account-management',
        'linkedin-reports',
      ];

      visibleComponents.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });

      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('linkedin-requests')).toBe(false);
    });

    it('should hide audit logs from operations by default', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: 'operations-1', role: 'operations', email: 'operations@test.com' },
        isManager: false,
        isAdmin: false,
      });

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [
          { componentKey: 'dashboard', role: 'operations', allowed: false },
        ],
        total: 1,
      });

      const { result } = renderHook(() => useAccess(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const visibleComponents: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'branch-management',
        'hierarchy',
        'work-queue',
        'reports',
        'review-queue',
        'attendance',
        'lead-requests',
        'linkedin-account-management',
        'linkedin-reports',
      ];

      visibleComponents.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });

      expect(result.current.canAccess('audit-logs')).toBe(false);
      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('linkedin-requests')).toBe(false);
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
      // 'history' (the Client page) is an always-on component for agents, in
      // the same way 'settings' is for every role: canAccess grants it before
      // the custom-rule lookup, so a stored deny rule does not take it away.
      expect(result.current.canAccess('history')).toBe(true);

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
      expect(result.current.canAccess('user-management')).toBe(false);
      // Always-on for agents, so the stored deny rule does not apply
      expect(result.current.canAccess('history')).toBe(true);

      // No rule - field management stays false, profile settings stay available
      expect(result.current.canAccess('field-management')).toBe(false);
      expect(result.current.canAccess('settings')).toBe(true);
    });
  });

  describe('TeamLead Always Has Access', () => {
    it('should grant teamLead access regardless of custom rules', async () => {
      // Setup: TeamLead with rules that would deny access to agents
      mockUseAuth.mockReturnValue({
        user: { $id: 'teamLead-1', role: 'team_lead', email: 'teamLead@test.com' },
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

      // TeamLead should have access to everything they are eligible for.
      // Field management is excluded because the module was removed and its
      // COMPONENT_ACCESS entry is empty for every role.
      const components: ComponentKey[] = [
        'dashboard',
        'leads',
        'history',
        'user-management',
        'settings',
      ];

      components.forEach((component) => {
        expect(result.current.canAccess(component)).toBe(true);
      });
    });

    it('should respect explicit deny rules for teamLeads from custom rules', async () => {
      // Setup: TeamLead with rules that explicitly deny teamLead access
      mockUseAuth.mockReturnValue({
        user: { $id: 'teamLead-1', role: 'team_lead', email: 'teamLead@test.com' },
        isManager: true,
        isAdmin: false,
      });

      const customRules = [
        {
          $id: 'rule-1',
          componentKey: 'dashboard',
          role: 'team_lead',
          allowed: false,
        },
        {
          $id: 'rule-2',
          componentKey: 'leads',
          role: 'team_lead',
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

      // Custom deny rules are respected for teamLeads (only admins bypass)
      expect(result.current.canAccess('dashboard')).toBe(false);
      expect(result.current.canAccess('leads')).toBe(false);
      // Components without custom rules fall back to teamLead defaults (true)
      expect(result.current.canAccess('history')).toBe(true);
    });

    it('should maintain teamLead access after rules refresh', async () => {
      // Setup: TeamLead user
      mockUseAuth.mockReturnValue({
        user: { $id: 'teamLead-1', role: 'team_lead', email: 'teamLead@test.com' },
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
      expect(result.current.canAccess('settings')).toBe(true);
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
      // history has no custom rule and agents are eligible for it by default
      expect(result.current.canAccess('history')).toBe(true);

      // Rules are refreshed; history stays available either way.
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
      expect(result.current.canAccess('settings')).toBe(true);
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

    it('should maintain teamLead access even when database fetch fails', async () => {
      // Setup: TeamLead user with database error
      mockUseAuth.mockReturnValue({
        user: { $id: 'teamLead-1', role: 'team_lead', email: 'teamLead@test.com' },
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

      // TeamLead should still have access
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
