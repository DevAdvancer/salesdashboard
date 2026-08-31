'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useAuth } from './auth-context';
import {
  getDefaultComponentAccess,
  isRoleEligibleForComponent,
} from '@/lib/constants/component-access';

export type ComponentKey =
  | 'dashboard'
  | 'chat'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management'
  | 'mock'
  | 'assessment-support'
  | 'interview-support'
  | 'hierarchy'
  | 'work-queue'
  | 'reports'
  | 'notifications'
  | 'attendance'
  | 'attendance-report'
  | 'lead-requests'
  | 'linkedin-requests'
  | 'linkedin-account-management'
  | 'linkedin-reports'
  | 'payments-report'
  | 'target-report'
  | 'technical-payments'
  | 'followups-payments'
  | 'resume-dashboard'
  | 'resume-profiles'
  | 'resume-marketing'
  | 'resume-chat'
  | 'resume-hierarchy'
  | 'request-calls'
  | 'call-requests'
  | 'assigned-report'
  | 'calendar'
  | 'team-report'
  | 'compliance-dashboard'
  | 'resume-reports'
  | 'my-call-requests';

interface AccessControlContextType {
  canAccess: (componentKey: ComponentKey) => boolean;
  isLoading: boolean;
  refreshRules: () => Promise<void>;
}

const AccessControlContext = createContext<AccessControlContextType | undefined>(undefined);
const SALES_ONLY_COMPONENTS = new Set<ComponentKey>([
  'dashboard',
  'chat',
  'leads',
  'history',
  'branch-management',
  'mock',
  'assessment-support',
  'interview-support',
  'hierarchy',
  'work-queue',
  'reports',
  'attendance-report',
  'lead-requests',
  'linkedin-requests',
  'linkedin-account-management',
  'linkedin-reports',
  'payments-report',
  'target-report',
  // Sales → Resume call-request raising page. A Sales-team feature;
  // resume-team members never raise call requests. Leadership roles are
  // exempt from the block via canCrossDashboards.
  'request-calls',
  'my-call-requests',
  'assigned-report',
  'calendar',
]);

function canCrossDashboards(role: NonNullable<ReturnType<typeof useAuth>['user']>['role']) {
  return (
    role === 'admin' ||
    role === 'developer' ||
    role === 'monitor' ||
    role === 'operations'
  );
}

export function AccessControlProvider({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  const [isLoading] = useState(false);

  const refreshRules = useCallback(async () => {
    // No-op since we no longer fetch dynamic rules
  }, []);

  const canAccess = useCallback((componentKey: ComponentKey): boolean => {
    if (!user) {
      return false;
    }

    if (
      user.department === 'resume' &&
      SALES_ONLY_COMPONENTS.has(componentKey) &&
      !canCrossDashboards(user.role)
    ) {
      return false;
    }

    // Explicit restriction for compliance role
    if (user.role === 'compliance') {
      if (componentKey === 'compliance-dashboard' || componentKey === 'settings') {
        return true;
      }
      return false;
    }

    // Department-aware component: only the resume team and the leadership
    // roles (admin / developer / monitor / operations) can see the resume
    // dashboard. Sales-team members are blocked here regardless of role
    // eligibility, and the empty `COMPONENT_ACCESS` entry for this key
    // means no role-only path opens it.
    if (
      componentKey === 'resume-dashboard' ||
      componentKey === 'resume-profiles' ||
      componentKey === 'resume-marketing' ||
      componentKey === 'resume-reports'
    ) {
      if (user.department === 'resume') return true;
      if (
        user.role === 'admin' ||
        user.role === 'developer' ||
        user.role === 'monitor' ||
        user.role === 'operations'
      ) {
        return true;
      }
      return false;
    }

    if (componentKey === 'compliance-dashboard') {
      if (
        user.role === 'admin' ||
        user.role === 'developer' ||
        user.role === 'monitor' ||
        user.role === 'operations'
      ) {
        return true;
      }
      return false;
    }

    // Same gating as the resume dashboard. The resume chat is a
    // separate route so leadership switching views can compare the two
    // teams' announcements / messages side by side.
    if (componentKey === 'resume-chat') {
      if (user.department === 'resume') return true;
      if (
        user.role === 'admin' ||
        user.role === 'developer' ||
        user.role === 'monitor' ||
        user.role === 'operations'
      ) {
        return true;
      }
      return false;
    }

    // Same gating as the resume dashboard / chat. The resume hierarchy
    // page is a Resume-team-only view; it never renders Sales-team
    // members even if a Sales TL shares the same $id in their data.
    if (componentKey === 'resume-hierarchy') {
      if (user.department === 'resume' && user.role !== 'agent' && user.role !== 'lead_generation') return true;
      if (
        user.role === 'admin' ||
        user.role === 'developer' ||
        user.role === 'monitor' ||
        user.role === 'operations'
      ) {
        return true;
      }
      return false;
    }

    // Same gating as the resume dashboard / chat / hierarchy. The Calls
    // page is a Resume-team-only view where incoming Sales call requests
    // land. Resume-team members always see it; leadership can open it via
    // the department switcher. Its COMPONENT_ACCESS entry is empty so no
    // role-only path opens it for Sales-team users.
    if (componentKey === 'call-requests') {
      if (user.department === 'resume') return true;
      if (
        user.role === 'admin' ||
        user.role === 'developer' ||
        user.role === 'monitor' ||
        user.role === 'operations'
      ) {
        return true;
      }
      return false;
    }

    if (!isRoleEligibleForComponent(componentKey, user.role)) {
      return false;
    }

    if (isAdmin) {
      return true;
    }

    // Monitor always uses default component-access — DB override rules are ignored
    // so admins cannot accidentally lock monitor out of hierarchy, audit-logs, etc.
    if (user.role === 'monitor' || user.role === 'operations') {
      return getDefaultComponentAccess(componentKey, user.role);
    }

    if (componentKey === 'settings') {
      return true;
    }

    if (componentKey === 'history' && user.role === 'agent') {
      return true;
    }

    // Rely exclusively on static rules
    return isRoleEligibleForComponent(componentKey, user.role);
  }, [user, isAdmin]);

  const value = useMemo<AccessControlContextType>(
    () => ({ canAccess, isLoading, refreshRules }),
    [canAccess, isLoading, refreshRules]
  );

  return (
    <AccessControlContext.Provider value={value}>
      {children}
    </AccessControlContext.Provider>
  );
}

export function useAccess() {
  const context = useContext(AccessControlContext);
  if (context === undefined) {
    throw new Error('useAccess must be used within an AccessControlProvider');
  }
  return context;
}
