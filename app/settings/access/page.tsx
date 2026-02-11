'use client';

import { useState, useEffect } from 'react';
import { databases } from '@/lib/appwrite';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ProtectedRoute } from '@/components/protected-route';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;

interface AccessRule {
  $id?: string;
  componentKey: ComponentKey;
  role: 'admin' | 'manager' | 'team_lead' | 'agent';
  allowed: boolean;
}

const ALL_COMPONENTS: { key: ComponentKey; label: string; description: string }[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Main dashboard view' },
  { key: 'leads', label: 'Leads', description: 'Active leads management' },
  { key: 'history', label: 'History', description: 'Closed leads history' },
  { key: 'user-management', label: 'User Management', description: 'Create and manage agents' },
  { key: 'field-management', label: 'Field Management', description: 'Configure lead form fields' },
  { key: 'settings', label: 'Settings', description: 'System settings and configuration' },
  { key: 'branch-management', label: 'Branch Management', description: 'Manage organizational branches' },
  { key: 'audit-logs', label: 'Audit Logs', description: 'System activity and user actions' },
];

export default function AccessConfigPage() {
  return (
    <ProtectedRoute componentKey="settings">
      <AccessConfigContent />
    </ProtectedRoute>
  );
}

function AccessConfigContent() {
  const { isAdmin, isManager } = useAuth();
  const { refreshRules } = useAccess();
  const [rules, setRules] = useState<Map<string, AccessRule>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      setIsLoading(true);
      const response = await databases.listDocuments(
        DATABASE_ID,
        ACCESS_CONFIG_COLLECTION_ID
      );

      const rulesMap = new Map<string, AccessRule>();
      response.documents.forEach((doc: any) => {
        const key = `${doc.componentKey}-${doc.role}`;
        rulesMap.set(key, {
          $id: doc.$id,
          componentKey: doc.componentKey,
          role: doc.role,
          allowed: doc.allowed,
        });
      });

      setRules(rulesMap);
    } catch (error) {
      console.error('Error fetching access rules:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAccess = async (componentKey: ComponentKey, role: 'manager' | 'team_lead' | 'agent') => {
    const key = `${componentKey}-${role}`;
    const existingRule = rules.get(key);
    const newAllowed = existingRule ? !existingRule.allowed : true;

    try {
      setIsSaving(true);

      if (existingRule?.$id) {
        await databases.updateDocument(
          DATABASE_ID,
          ACCESS_CONFIG_COLLECTION_ID,
          existingRule.$id,
          { allowed: newAllowed }
        );
      } else {
        const newDoc = await databases.createDocument(
          DATABASE_ID,
          ACCESS_CONFIG_COLLECTION_ID,
          'unique()',
          { componentKey, role, allowed: newAllowed }
        );

        const updatedRules = new Map(rules);
        updatedRules.set(key, {
          $id: newDoc.$id,
          componentKey,
          role,
          allowed: newAllowed,
        });
        setRules(updatedRules);
        await refreshRules();
        return;
      }

      const updatedRules = new Map(rules);
      updatedRules.set(key, { ...existingRule!, allowed: newAllowed });
      setRules(updatedRules);
      await refreshRules();
    } catch (error) {
      console.error('Error updating access rule:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const isAllowed = (componentKey: ComponentKey, role: 'manager' | 'team_lead' | 'agent'): boolean => {
    const key = `${componentKey}-${role}`;
    const rule = rules.get(key);
    if (rule !== undefined) return rule.allowed;
    // Defaults: 
    // - manager=true (except branch-management)
    // - team_lead=true (dashboard, leads, history, user-management)
    // - agent=false (except dashboard, leads)
    if (role === 'manager') return componentKey !== 'branch-management';
    if (role === 'team_lead') return ['dashboard', 'leads', 'history', 'user-management'].includes(componentKey);
    if (role === 'agent') return componentKey === 'dashboard' || componentKey === 'leads';
    return false;
  };

  // Admin sees all components (including branch-management)
  // Manager sees all except branch-management
  const visibleComponents = isAdmin
    ? ALL_COMPONENTS
    : ALL_COMPONENTS.filter((c) => c.key !== 'branch-management');

  // Admin can toggle: manager + team_lead + agent columns
  // Manager can toggle: team_lead + agent columns only
  const canEditManager = isAdmin;
  const canEditTeamLead = isAdmin || isManager;
  const canEditAgent = isAdmin || isManager;

  if (isLoading) {
    return (
      <div className="container mx-auto">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl">Access Control Configuration</CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Configure which components are visible to managers, team leads, and agents. Admin always has full access.'
              : 'Configure which components are visible to team leads and agents. Managers always have full access.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Header Row */}
            <div className={`hidden sm:grid gap-4 pb-4 border-b ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'}`}>
              <div className="font-semibold">Component</div>
              {isAdmin && <div className="font-semibold text-center">Manager</div>}
              <div className="font-semibold text-center">Team Lead</div>
              <div className="font-semibold text-center">Agent</div>
              <div />
            </div>

            {/* Component Rows */}
            {visibleComponents.map((component) => (
              <div
                key={component.key}
                className={`grid grid-cols-1 gap-2 items-center border-b sm:border-b-0 pb-4 sm:pb-0 ${
                  isAdmin ? 'sm:grid-cols-5 sm:gap-4' : 'sm:grid-cols-4 sm:gap-4'
                }`}
              >
                <div>
                  <Label className="font-medium">{component.label}</Label>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {component.description}
                  </p>
                </div>

                {/* Manager column — only visible to admin */}
                {isAdmin && (
                  <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                    <span className="text-sm text-muted-foreground sm:hidden">Manager:</span>
                    <input
                      type="checkbox"
                      checked={isAllowed(component.key, 'manager')}
                      onChange={() => toggleAccess(component.key, 'manager')}
                      disabled={isSaving}
                      className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                    />
                  </div>
                )}

                {/* Team Lead column */}
                <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                  <span className="text-sm text-muted-foreground sm:hidden">Team Lead:</span>
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, 'team_lead')}
                    onChange={() => toggleAccess(component.key, 'team_lead')}
                    disabled={isSaving || !canEditTeamLead}
                    className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                  />
                </div>

                {/* Agent column */}
                <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                  <span className="text-sm text-muted-foreground sm:hidden">Agent:</span>
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, 'agent')}
                    onChange={() => toggleAccess(component.key, 'agent')}
                    disabled={isSaving || !canEditAgent}
                    className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                  />
                </div>

                <div />
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {isAdmin ? (
                <>
                  <strong>Note:</strong> Changes are saved immediately. Admin always has full access to all components.
                  Toggle the checkboxes to control what managers, team leads, and agents can see.
                </>
              ) : (
                <>
                  <strong>Note:</strong> Changes are saved immediately. Managers always have access to all components.
                  Team leads and agents will only see components that are checked in their columns.
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
