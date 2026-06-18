"use client";

import { useEffect, useState } from "react";
import { FollowUpQueueCard } from "@/components/dashboard/follow-up-queue";
import { RoleWorkDashboard } from "@/components/dashboard/role-work-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { getTeamLeads } from "@/lib/services/user-service";
import type { User } from "@/lib/types";
import { loadDashboardData } from "@/lib/services/dashboard-data-service";

export default function WorkQueuePage() {
  return (
    <ProtectedRoute componentKey="work-queue">
      <WorkQueueContent />
    </ProtectedRoute>
  );
}

function WorkQueueContent() {
  const { user, isAdmin, isTeamLead, isMonitor, isOperations } =
    useAuth();
  const canReadLikeAdmin = isAdmin || isMonitor || isOperations;
  const [insights, setInsights] = useState<LeadershipDashboardInsights | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamLeads, setTeamLeads] = useState<User[]>([]);
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string>("");

  useEffect(() => {
    if (!user || !canReadLikeAdmin) return;
    let cancelled = false;

    async function loadTeamLeads() {
      try {
        const leads = await getTeamLeads(undefined, "sales");
        if (cancelled) return;
        setTeamLeads(leads);
        if (leads.length > 0) {
          setSelectedTeamLeadId((current) => current || leads[0].$id);
        }
      } catch {
        if (cancelled) return;
        setTeamLeads([]);
        setSelectedTeamLeadId("");
      }
    }

    void loadTeamLeads();

    return () => {
      cancelled = true;
    };
  }, [user, canReadLikeAdmin]);

  useEffect(() => {
    async function loadQueue() {
      if (!user) return;
      try {
        setLoading(true);
        setError(null);
        const teamLeadId = canReadLikeAdmin ? selectedTeamLeadId : undefined;
        if (canReadLikeAdmin && !teamLeadId) {
          setInsights(null);
          setLoading(false);
          return;
        }
        const data = await loadDashboardData({
          user,
          isAdminLike: canReadLikeAdmin,
          isTeamLead,
          teamLeadId,
          includeAllBranchesForAdminLike: false,
          departmentScope: "sales",
        });
        setInsights(data.insights);
      } catch (error) {
        console.error("Failed to load work queue:", error);
        setInsights(null);
        setError("Work queue is not available for your current permissions.");
      } finally {
        setLoading(false);
      }
    }

    void loadQueue();
  }, [
    user,
    canReadLikeAdmin,
    isTeamLead,
    selectedTeamLeadId,
    teamLeads,
  ]);

  const selectedTeamLeadName = canReadLikeAdmin
    ? teamLeads.find((candidate) => candidate.$id === selectedTeamLeadId)?.name
    : null;

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Work Queue</h1>
          <p className="text-muted-foreground">
            Daily follow-ups, overdue work, and active lead pressure.
          </p>
        </div>
        {canReadLikeAdmin && (
          <div className="w-full max-w-xs space-y-2">
            <Label htmlFor="workQueueTeam">Team</Label>
            <select
              id="workQueueTeam"
              value={selectedTeamLeadId}
              onChange={(event) => setSelectedTeamLeadId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading || teamLeads.length === 0}
            >
              {teamLeads.length === 0 ? (
                <option value="">No teams available</option>
              ) : (
                teamLeads.map((teamLead) => (
                  <option key={teamLead.$id} value={teamLead.$id}>
                    {teamLead.name}
                  </option>
                ))
              )}
            </select>
            {selectedTeamLeadName ? (
              <p className="text-xs text-muted-foreground">
                Viewing {selectedTeamLeadName}&apos;s team queue
              </p>
            ) : null}
          </div>
        )}
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
            role={canReadLikeAdmin ? "team_lead" : user.role}
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
