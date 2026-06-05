"use client";

import { useEffect, useState } from "react";
import { listLeads } from "@/lib/services/lead-action-service";
import { FollowUpQueueCard } from "@/components/dashboard/follow-up-queue";
import { RoleWorkDashboard } from "@/components/dashboard/role-work-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  getTeamLeads,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import type { Branch, User } from "@/lib/types";
import { listClientPaymentSummariesAction } from "@/app/actions/client-payments";

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
  const [teamLeads, setTeamLeads] = useState<User[]>([]);
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string>("");

  useEffect(() => {
    if (!user || !isAdmin) return;
    let cancelled = false;

    async function loadTeamLeads() {
      try {
        const leads = await getTeamLeads();
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
  }, [user, isAdmin]);

  useEffect(() => {
    async function loadQueue() {
      if (!user) return;
      try {
        setLoading(true);
        setError(null);
        const teamLeadId = isAdmin ? selectedTeamLeadId : undefined;
        if (isAdmin && !teamLeadId) {
          setInsights(null);
          setLoading(false);
          return;
        }
        const [activeLeads, closedLeads] = await Promise.all([
          listLeads(
            { isClosed: false, teamLeadId },
            user.$id,
            user.role,
            user.branchIds,
          ),
          listLeads(
            { isClosed: true, teamLeadId },
            user.$id,
            user.role,
            user.branchIds,
          ),
        ]);
        let usersForInsights: User[] = [user];
        if (isAdmin) {
          const selectedTeamLead = teamLeads.find(
            (candidate) => candidate.$id === selectedTeamLeadId,
          );
          if (selectedTeamLead) {
            usersForInsights = [
              selectedTeamLead,
              ...(await getAgentsByTeamLead(selectedTeamLead.$id)),
            ];
          }
        } else if (isManager || isAssistantManager) {
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
        const branches: Branch[] = allBranches.filter((branch) =>
          branchIds.has(branch.$id),
        );

        const visibleLeadIds = Array.from(
          new Set([...activeLeads, ...closedLeads].map((lead) => lead.$id)),
        );

        const paymentSummaries = visibleLeadIds.length > 0
          ? await listClientPaymentSummariesAction({ actorId: user.$id, leadIds: visibleLeadIds })
          : [];

        setInsights(
          buildLeadershipDashboardInsights({
            leads: [...activeLeads, ...closedLeads],
            users: usersForInsights,
            branches,
            paymentSummaries,
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
  }, [
    user,
    isAdmin,
    isAssistantManager,
    isManager,
    isTeamLead,
    selectedTeamLeadId,
    teamLeads,
  ]);

  const selectedTeamLeadName = isAdmin
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
        {isAdmin && (
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
            role={isAdmin ? "team_lead" : user.role}
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
