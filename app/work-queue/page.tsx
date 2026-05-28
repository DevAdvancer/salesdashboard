"use client";

import { useEffect, useState } from "react";
import { listLeads } from "@/lib/services/lead-action-service";
import { FollowUpQueueCard } from "@/components/dashboard/follow-up-queue";
import { RoleWorkDashboard } from "@/components/dashboard/role-work-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  buildLeadershipDashboardInsights,
  resolveLeadUsersForInsights,
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { listBranches } from "@/lib/services/branch-service";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import type { Branch, User } from "@/lib/types";

export default function WorkQueuePage() {
  return (
    <ProtectedRoute componentKey="work-queue">
      <WorkQueueContent />
    </ProtectedRoute>
  );
}

function WorkQueueContent() {
  const { user, isAdmin, isManager, isAssistantManager, isTeamLead } =
    useAuth();
  const [insights, setInsights] = useState<LeadershipDashboardInsights | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadQueue() {
      if (!user) return;
      try {
        setLoading(true);
        setError(null);
        const [activeLeads, closedLeads] = await Promise.all([
          listLeads(
            { isClosed: false },
            user.$id,
            user.role,
            user.branchIds,
          ),
          listLeads(
            { isClosed: true },
            user.$id,
            user.role,
            user.branchIds,
          ),
        ]);
        let usersForInsights: User[] = [user];
        if (isAdmin || isManager || isAssistantManager) {
          const visibleUsers = await getAssignableUsers(
            user.role,
            user.branchIds || [],
            user.$id,
          );
          usersForInsights = [
            user,
            ...visibleUsers.filter(
              (visibleUser) => visibleUser.$id !== user.$id,
            ),
          ];
        } else if (isTeamLead) {
          usersForInsights = [user, ...(await getAgentsByTeamLead(user.$id))];
        }
        usersForInsights = await resolveLeadUsersForInsights({
          leads: [...activeLeads, ...closedLeads],
          users: usersForInsights,
          getUserByIdOrNull,
        });
        const allBranches = await listBranches();
        const branchIds = new Set([
          ...usersForInsights.flatMap(
            (visibleUser) => visibleUser.branchIds || [],
          ),
          ...activeLeads
            .map((lead) => lead.branchId)
            .filter((branchId): branchId is string => Boolean(branchId)),
          ...closedLeads
            .map((lead) => lead.branchId)
            .filter((branchId): branchId is string => Boolean(branchId)),
        ]);
        const branches: Branch[] = allBranches.filter(
          (branch) => isAdmin || branchIds.has(branch.$id),
        );
        setInsights(
          buildLeadershipDashboardInsights({
            leads: [...activeLeads, ...closedLeads],
            users: usersForInsights,
            branches,
          }),
        );
      } catch (error) {
        console.error("Failed to load work queue:", error);
        setInsights(null);
        setError("Work queue is not available for your current permissions.");
      } finally {
        setLoading(false);
      }
    }

    void loadQueue();
  }, [user, isAdmin, isAssistantManager, isManager, isTeamLead]);

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Work Queue</h1>
          <p className="text-muted-foreground">
            Daily follow-ups, overdue work, and active lead pressure.
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {user && (
        <div id="tour-work-queue-tabs">
          <RoleWorkDashboard
            role={user.role}
            insights={insights}
            isLoading={loading}
          />
        </div>
      )}
      <div id="tour-work-queue-actions">
        <FollowUpQueueCard
          queue={insights?.followUpQueue ?? null}
          isLoading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How to use this queue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Open a lead from the normal Leads page, set its next follow-up and
            next action, then it will appear here when due.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
