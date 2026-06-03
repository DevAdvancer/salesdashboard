'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { databases } from '@/lib/appwrite';
import { useAuth } from './auth-context';
import {
  getDefaultComponentAccess,
  isRoleEligibleForComponent,
} from '@/lib/constants/component-access';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;

export type ComponentKey =
  | 'dashboard'
  | 'chat'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management'
  | 'audit-logs'
  | 'mock'
  | 'assessment-support'
  | 'interview-support'
  | 'hierarchy'
  | 'work-queue'
  | 'reports'
  | 'coaching-notes'
  | 'review-queue'
  | 'notifications'
  | 'attendance'
  | 'lead-requests'
  | 'linkedin-requests'
  | 'linkedin-account-management'
  | 'linkedin-reports';

interface AccessControlContextType {
  canAccess: (componentKey: ComponentKey) => boolean;
  isLoading: boolean;
  refreshRules: () => Promise<void>;
}

const AccessControlContext = createContext<AccessControlContextType | undefined>(undefined);

export function AccessControlProvider({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  const [rules, setRules] = useState<Map<string, boolean>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const response = await databases.listDocuments(
        DATABASE_ID,
        ACCESS_CONFIG_COLLECTION_ID
      );

      const rulesMap = new Map<string, boolean>();
      response.documents.forEach((doc) => {
        const rule = doc as unknown as { componentKey: string; role: string; allowed: boolean };
        const key = `${rule.componentKey}-${rule.role}`;
        rulesMap.set(key, rule.allowed);
      });

      setRules(rulesMap);
    } catch (error) {
      console.error('Error fetching access rules:', error);
      // Use empty map on error - will fall back to defaults
      setRules(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const canAccess = useCallback((componentKey: ComponentKey): boolean => {
    if (!user) {
      return false;
    }

    if (!isRoleEligibleForComponent(componentKey, user.role)) {
      return false;
    }

    if (isAdmin) {
      return true;
    }

    if (componentKey === 'settings') {
      return true;
    }

    if (componentKey === 'history' && user.role === 'agent') {
      return true;
    }

    // Check for custom rule from DB
    const ruleKey = `${componentKey}-${user.role}`;
    const customRule = rules.get(ruleKey);

    if (customRule !== undefined) {
      return customRule;
    }

    return getDefaultComponentAccess(componentKey, user.role);
  }, [user, isAdmin, rules]);

  const refreshRules = useCallback(async () => {
    await fetchRules();
  }, [fetchRules]);

  return (
    <AccessControlContext.Provider value={{ canAccess, isLoading, refreshRules }}>
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
