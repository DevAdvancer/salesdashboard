'use client';

import { useState, useEffect } from 'react';
import { databases } from '@/lib/appwrite';
import { useAuth } from '@/lib/contexts/auth-context';
import { ComponentKey } from '@/lib/contexts/access-control-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;

interface AccessRule {
  $id?: string;
  componentKey: ComponentKey;
  role: 'manager' | 'agent';
  allowed: boolean;
}

const COMPONENTS: { key: ComponentKey; label: string; description: string }[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Main dashboard view' },
  { key: 'leads', label: 'Leads', description: 'Active leads management' },
  { key: 'history', label: 'History', description: 'Closed leads history' },
  { key: 'user-management', label: 'User Management', description: 'Create and manage agents' },
  { key: 'field-management', label: 'Field Management', description: 'Configure lead form fields' },
  { key: 'settings', label: 'Settings', description: 'System settings and configuration' },
];

export default function AccessConfigPage() {
  const { isManager } = useAuth();
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

  const toggleAccess = async (componentKey: ComponentKey, role: 'manager' | 'agent') => {
    const key = `${componentKey}-${role}`;
    const existingRule = rules.get(key);
    const newAllowed = existingRule ? !existingRule.allowed : true;

    try {
      setIsSaving(true);

      if (existingRule?.$id) {
        // Update existing rule
        await databases.updateDocument(
          DATABASE_ID,
          ACCESS_CONFIG_COLLECTION_ID,
          existingRule.$id,
          { allowed: newAllowed }
        );
      } else {
        // Create new rule
        const newDoc = await databases.createDocument(
          DATABASE_ID,
          ACCESS_CONFIG_COLLECTION_ID,
          'unique()',
          {
            componentKey,
            role,
            allowed: newAllowed,
          }
        );

        const updatedRules = new Map(rules);
        updatedRules.set(key, {
          $id: newDoc.$id,
          componentKey,
          role,
          allowed: newAllowed,
        });
        setRules(updatedRules);
        return;
      }

      // Update local state
      const updatedRules = new Map(rules);
      updatedRules.set(key, {
        ...existingRule,
        allowed: newAllowed,
      });
      setRules(updatedRules);
    } catch (error) {
      console.error('Error updating access rule:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const isAllowed = (componentKey: ComponentKey, role: 'manager' | 'agent'): boolean => {
    const key = `${componentKey}-${role}`;
    const rule = rules.get(key);

    if (rule !== undefined) {
      return rule.allowed;
    }

    // Default: manager=true, agent=false
    return role === 'manager';
  };

  if (!isManager) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Access Control Configuration</CardTitle>
          <CardDescription>
            Configure which components are visible to different user roles.
            Managers always have full access regardless of these settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Header Row */}
            <div className="grid grid-cols-3 gap-4 pb-4 border-b">
              <div className="font-semibold">Component</div>
              <div className="font-semibold text-center">Manager</div>
              <div className="font-semibold text-center">Agent</div>
            </div>

            {/* Component Rows */}
            {COMPONENTS.map((component) => (
              <div key={component.key} className="grid grid-cols-3 gap-4 items-center">
                <div>
                  <Label className="font-medium">{component.label}</Label>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {component.description}
                  </p>
                </div>

                {/* Manager Checkbox (Always Disabled) */}
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                {/* Agent Checkbox */}
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, 'agent')}
                    onChange={() => toggleAccess(component.key, 'agent')}
                    disabled={isSaving}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Note:</strong> Changes are saved immediately. Managers always have access to all components.
              Agents will only see components that are checked in their column.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
