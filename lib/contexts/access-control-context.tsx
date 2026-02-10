'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { databases } from '@/lib/appwrite';
import { useAuth } from './auth-context';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;

export type ComponentKey =
  | 'dashboard'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management';

interface AccessRule {
  $id: string;
  componentKey: ComponentKey;
  role: 'manager' | 'agent';
  allowed: boolean;
}

interface AccessControlContextType {
  canAccess: (componentKey: ComponentKey) => boolean;
  isLoading: boolean;
  refreshRules: () => Promise<void>;
}

const AccessControlContext = createContext<AccessControlContextType | undefined>(undefined);

export function AccessControlProvider({ children }: { children: React.ReactNode }) {
  const { user, isManager, isAdmin } = useAuth();
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
      response.documents.forEach((doc: any) => {
        const key = `${doc.componentKey}-${doc.role}`;
        rulesMap.set(key, doc.allowed);
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
    // Admins always have full access to everything
    if (isAdmin) {
      return true;
    }

    if (!user) {
      return false;
    }

    // Check for custom rule from DB
    const ruleKey = `${componentKey}-${user.role}`;
    const customRule = rules.get(ruleKey);

    if (customRule !== undefined) {
      return customRule;
    }

    // Default rules when no DB rule exists:
    // manager=true (except branch-management), agent=dashboard+leads only
    if (user.role === 'manager') {
      return componentKey !== 'branch-management';
    }
    if (user.role === 'agent') {
      return componentKey === 'dashboard' || componentKey === 'leads';
    }
    return false;
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
