"use client";

import { useEffect, useState } from "react";
import { listLeads } from "@/lib/services/lead-action-service";
import { LeadershipDashboard } from "@/components/dashboard/leadership-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  buildLeadershipDashboardInsights,
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { listBranches } from "@/lib/services/branch-service";
import { getAssignableUsers } from "@/lib/services/user-service";
import type { Branch, User } from "@/lib/types";

export default function ReportsPage() {
  return (
    <ProtectedRoute componentKey="reports">
      <ReportsContent />
    </ProtectedRoute>
  );
}

function ReportsContent() {
  const { user, isAdmin } = useAuth();
  const [insights, setInsights] = useState<LeadershipDashboardInsights | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReports() {
      if (!user) return;
      try {
        setLoading(true);
        setError(null);
        const [activeLeads, closedLeads, visibleUsers, allBranches] =
          await Promise.all([
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
            getAssignableUsers(user.role, user.branchIds || [], user.$id),
            listBranches(),
          ]);
        const usersForInsights: User[] = [
          user,
          ...visibleUsers.filter((visibleUser) => visibleUser.$id !== user.$id),
        ];
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
        console.error("Failed to load reports:", error);
        setInsights(null);
        setError("Reports are not available for your current permissions.");
      } finally {
        setLoading(false);
      }
    }

    void loadReports();
  }, [user, isAdmin]);

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Branch, workload, status, and revenue summaries for your role scope.
        </p>
      </div>
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}
      <LeadershipDashboard
        role={user.role}
        insights={insights}
        isLoading={loading}
      />
      <Card>
        <CardHeader>
          <CardTitle>Report exports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Export history can be added later without changing the current Leads
            or Current Clients views.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
