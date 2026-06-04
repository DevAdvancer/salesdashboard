"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateAccessRuleAction } from "@/app/actions/access-settings";
import { databases } from "@/lib/appwrite";
import { useAuth } from "@/lib/contexts/auth-context";
import { useAccess, ComponentKey } from "@/lib/contexts/access-control-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ProtectedRoute } from "@/components/protected-route";
import {
  getDefaultComponentAccess,
  isRoleEligibleForComponent,
} from "@/lib/constants/component-access";
import type { UserRole } from "@/lib/types";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;

interface AccessRule {
  $id?: string;
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

const ALL_COMPONENTS: {
  key: ComponentKey;
  label: string;
  description: string;
}[] = [
  { key: "dashboard", label: "Dashboard", description: "Main dashboard view" },
  { key: "chat", label: "Chatting", description: "Announcements and team chat" },
  { key: "leads", label: "Leads", description: "Active leads management" },
  {
    key: "history",
    label: "Client",
    description: "Closed leads/client records",
  },
  {
    key: "user-management",
    label: "User Management",
    description: "Create and manage agents",
  },
  {
    key: "linkedin-requests",
    label: "Linkedin Request",
    description: "Send and track Linkedin connection requests",
  },
  {
    key: "linkedin-account-management",
    label: "Linkedin Account Management",
    description: "Assign Linkedin IDs (Main + Sudo) to agents",
  },
  {
    key: "linkedin-reports",
    label: "Linkedin Reports",
    description: "Weekly team reports for Linkedin outreach",
  },
  {
    key: "settings",
    label: "Settings",
    description: "System settings and configuration",
  },
  {
    key: "branch-management",
    label: "Branch Management",
    description: "Manage organizational branches",
  },
  {
    key: "audit-logs",
    label: "Audit Logs",
    description: "System activity and user actions",
  },
  {
    key: "mock",
    label: "Mock Interview",
    description: "Mock interview support workflow",
  },
  {
    key: "assessment-support",
    label: "Assessment",
    description: "Assessment support workflow",
  },
  {
    key: "interview-support",
    label: "Interview Support",
    description: "Interview support workflow",
  },
  {
    key: "hierarchy",
    label: "Hierarchy",
    description: "Organization reporting structure",
  },
  {
    key: "work-queue",
    label: "Work Queue",
    description: "Daily follow-up and stale lead queue",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Role-based performance reports",
  },
  {
    key: "coaching-notes",
    label: "Coaching Notes",
    description: "Leadership notes for team coaching",
  },
  {
    key: "review-queue",
    label: "Review Queue",
    description: "Escalations, approvals, and review items",
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "User alerts and reminders",
  },
];

export default function AccessConfigPage() {
  return (
    <ProtectedRoute componentKey="settings">
      <AccessConfigContent />
    </ProtectedRoute>
  );
}

function AccessConfigContent() {
  const { user, isAdmin, isDeveloper } = useAuth();
  const { refreshRules } = useAccess();
  const router = useRouter();
  const [rules, setRules] = useState<Map<string, AccessRule>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const canManageAccess =
    user?.role === "admin" || user?.role === "developer";

  useEffect(() => {
    if (user && !canManageAccess) {
      router.push("/settings");
      return;
    }

    fetchRules();
  }, [canManageAccess, router, user]);

  const fetchRules = async () => {
    try {
      setIsLoading(true);
      const response = await databases.listDocuments(
        DATABASE_ID,
        ACCESS_CONFIG_COLLECTION_ID,
      );

      const rulesMap = new Map<string, AccessRule>();
      response.documents.forEach((doc) => {
        const rule = doc as unknown as AccessRule;
        const key = `${rule.componentKey}-${rule.role}`;
        rulesMap.set(key, {
          $id: rule.$id,
          componentKey: rule.componentKey,
          role: rule.role,
          allowed: rule.allowed,
        });
      });

      setRules(rulesMap);
    } catch (error) {
      console.error("Error fetching access rules:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAccess = async (
    componentKey: ComponentKey,
    role: Exclude<UserRole, "admin" | "developer">,
  ) => {
    if (!user) {
      return;
    }

    if (componentKey === "settings") {
      return;
    }

    if (!isRoleEligibleForComponent(componentKey, role)) {
      return;
    }

    const key = `${componentKey}-${role}`;
    const existingRule = rules.get(key);
    // Calculate new allowed state based on CURRENT effective permission
    const currentAllowed = isAllowed(componentKey, role);
    const newAllowed = !currentAllowed;

    try {
      setIsSaving(true);
      const savedRule = await updateAccessRuleAction({
        currentUserId: user.$id,
        componentKey,
        role,
        allowed: newAllowed,
        ruleId: existingRule?.$id,
      });

      const updatedRules = new Map(rules);
      updatedRules.set(key, {
        $id: savedRule.$id,
        componentKey: savedRule.componentKey,
        role: savedRule.role as UserRole,
        allowed: savedRule.allowed,
      });
      setRules(updatedRules);
      await refreshRules();
    } catch (error) {
      console.error("Error updating access rule:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const isAllowed = (
    componentKey: ComponentKey,
    role: Exclude<UserRole, "admin" | "developer">,
  ): boolean => {
    if (componentKey === "settings") {
      return isRoleEligibleForComponent(componentKey, role);
    }

    if (!isRoleEligibleForComponent(componentKey, role)) {
      return false;
    }

    const key = `${componentKey}-${role}`;
    const rule = rules.get(key);
    if (rule !== undefined) return rule.allowed;
    return getDefaultComponentAccess(componentKey, role);
  };

  const isAdminOrDev = isAdmin || isDeveloper;
  const visibleComponents = ALL_COMPONENTS;

  const canEditMonitor = isAdminOrDev;
  const canEditTeamLead = isAdminOrDev;
  const canEditAgent = isAdminOrDev;
  const canEditLeadGeneration = isAdminOrDev;

  if (!canManageAccess) {
    return null;
  }

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
          <CardTitle className="text-xl md:text-2xl">
            Access Control Configuration
          </CardTitle>
          <CardDescription>
            Configure which components are visible to monitors, team leads, lead
            generation users, and agents. Admin and Developer always have full
            access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Header Row */}
            <div
              className="hidden sm:grid gap-4 pb-4 border-b grid-cols-6">
              <div className="font-semibold">Component</div>
              <div className="font-semibold text-center">Monitor</div>
              <div className="font-semibold text-center">Team Lead</div>
              <div className="font-semibold text-center">Lead Gen</div>
              <div className="font-semibold text-center">Agent</div>
              <div />
            </div>

            {/* Component Rows */}
            {visibleComponents.map((component) => (
              <div
                key={component.key}
                className="grid grid-cols-1 gap-2 items-center border-b sm:border-b-0 pb-4 sm:pb-0 sm:grid-cols-6 sm:gap-4">
                <div>
                  <Label className="font-medium">{component.label}</Label>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {component.description}
                  </p>
                </div>

                {/* Manager column — only visible to admin/developer */}
                {isAdminOrDev && (
                  <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                    <span className="text-sm text-muted-foreground sm:hidden">
                      Monitor:
                    </span>
                    <input
                      type="checkbox"
                      checked={isAllowed(component.key, "monitor")}
                      onChange={() => toggleAccess(component.key, "monitor")}
                      disabled={
                        isSaving ||
                        component.key === "settings" ||
                        !canEditMonitor ||
                        !isRoleEligibleForComponent(component.key, "monitor")
                      }
                      className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                    />
                  </div>
                )}

                {/* Assistant Manager column — only visible to admin/developer */}
                {/* Team Lead column */}
                <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                  <span className="text-sm text-muted-foreground sm:hidden">
                    Team Lead:
                  </span>
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, "team_lead")}
                    onChange={() => toggleAccess(component.key, "team_lead")}
                    disabled={
                      isSaving ||
                      component.key === "settings" ||
                      !canEditTeamLead ||
                      !isRoleEligibleForComponent(component.key, "team_lead")
                    }
                    className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                  />
                </div>

                {/* Lead Generation column */}
                <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                  <span className="text-sm text-muted-foreground sm:hidden">
                    Lead Gen:
                  </span>
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, "lead_generation")}
                    onChange={() =>
                      toggleAccess(component.key, "lead_generation")
                    }
                    disabled={
                      isSaving ||
                      component.key === "settings" ||
                      !canEditLeadGeneration ||
                      !isRoleEligibleForComponent(
                        component.key,
                        "lead_generation",
                      )
                    }
                    className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                  />
                </div>

                {/* Agent column */}
                <div className="flex sm:justify-center items-center gap-2 sm:gap-0">
                  <span className="text-sm text-muted-foreground sm:hidden">
                    Agent:
                  </span>
                  <input
                    type="checkbox"
                    checked={isAllowed(component.key, "agent")}
                    onChange={() => toggleAccess(component.key, "agent")}
                    disabled={
                      isSaving ||
                      component.key === "settings" ||
                      !canEditAgent ||
                      !isRoleEligibleForComponent(component.key, "agent")
                    }
                    className="h-5 w-5 rounded border-input disabled:opacity-50 cursor-pointer"
                  />
                </div>

                <div />
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Note:</strong> Changes are saved immediately. Admin and
              Developer always have full access to all components. Toggle the
              checkboxes to control what monitors, team leads, lead generation
              users, and agents can see.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
