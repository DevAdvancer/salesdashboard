"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProtectedRoute } from "@/components/protected-route";
import { listLeads } from "@/lib/services/lead-action-service";
import { useLeadCountsQuery } from "@/lib/queries/leads/use-lead-counts-query";
import { getMockAttempts } from "@/app/actions/mock";
import { getInterviewAttempts } from "@/app/actions/interview";
import { getAssessmentAttempts } from "@/app/actions/assessment";
import { Skeleton } from "@/components/ui/skeleton";
import type { Branch, User } from "@/lib/types";
import { appIcons } from "@/components/navigation-config";
import { LeadershipDashboard } from "@/components/dashboard/leadership-dashboard";
import { FollowUpQueueCard } from "@/components/dashboard/follow-up-queue";
import { RoleWorkDashboard } from "@/components/dashboard/role-work-dashboard";
import {
  buildLeadershipDashboardInsights,
  resolveLeadUsersForInsights,
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { listAllPaymentInsightsAction, listClientPaymentSummariesAction, type PaymentInsightRecord } from "@/app/actions/client-payments";
import { FinancialInsightsSection } from "@/components/dashboard/financial-insights-section";




type AssignedAgent = User & {
  branchNames: string;
};

type LeadGenerationTeamAssignmentStat = {
  teamLeadId: string;
  teamLeadName: string;
  assignedLeads: number;
};



function LegacyDashboardContent() {
  const { user, isAdmin, isManager, isAssistantManager, isAgent, isTeamLead, isMonitor, isOperations } =
    useAuth();
  const isReadOnlyAdminView = isMonitor || isOperations;
  const router = useRouter();

  // Exact counts for the dashboard cards. Replaces the previous
  // listLeads-driven counts (which were capped by the action's
  // default pageSize and could understate large tenants).
  const countsQuery = useLeadCountsQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
  });

  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    createdMocks: 0,
    createdInterviewSupport: 0,
    createdAssessmentSupport: 0,
    loading: true,
  });

  // Promote the TanStack counts query result into the metrics state.
  // The counts query is uncapped (Appwrite returns `total` only),
  // so this overrides any array-length-based numbers from the
  // legacy listLeads fetch when both are available.
  useEffect(() => {
    if (!countsQuery.data) return;
    setMetrics((prev) => ({
      ...prev,
      activeLeads: countsQuery.data.active,
      closedLeads: countsQuery.data.closed,
      loading: prev.loading && countsQuery.isLoading,
    }));
  }, [countsQuery.data, countsQuery.isLoading]);

  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);
  const [assignedAgents, setAssignedAgents] = useState<AssignedAgent[]>([]);
  const [isOutlookChecking, setIsOutlookChecking] = useState(true);
  const [dashboardInsights, setDashboardInsights] =
    useState<LeadershipDashboardInsights | null>(null);
  const [dashboardInsightsLoading, setDashboardInsightsLoading] =
    useState(false);
  const [paymentInsights, setPaymentInsights] = useState<PaymentInsightRecord[]>([]);
  const [paymentInsightsLoading, setPaymentInsightsLoading] = useState(false);

  // Memoize the "My Agents" table rows so unrelated re-renders (e.g. a
  // payment-insights refresh) don't rebuild every <tr>.
  const assignedAgentRows = useMemo(
    () =>
      assignedAgents.map((agent) => (
        <tr
          key={agent.$id}
          className="border-b last:border-0 hover:bg-muted/50 transition-colors">
          <td className="p-3 text-sm">{agent.name}</td>
          <td className="p-3 text-sm text-muted-foreground">{agent.email}</td>
          <td className="p-3 text-sm">{agent.branchNames || "N/A"}</td>
          <td className="p-3 text-sm">
            <span className="inline-flex items-center rounded-full bg-[var(--soft-cloud)] px-3 py-1 text-xs font-medium text-[var(--success)]">
              Active
            </span>
          </td>
        </tr>
      )),
    [assignedAgents],
  );


  // Check Outlook connection status — once per session, not every mount.
  useEffect(() => {
    const OUTLOOK_CHECKED_KEY = "crm:outlook-checked";
    if (typeof window === "undefined") return;
    if (!user) return;
    if (window.sessionStorage.getItem(OUTLOOK_CHECKED_KEY) === "1") {
      setIsOutlookChecking(false);
      return;
    }

    const checkOutlookConnection = async () => {
      try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();

        if (!data.connected) {
          // If not connected, redirect to login
          console.log("Outlook not connected, redirecting to login...");
          window.location.href = "/api/auth/login";
          return;
        }
        window.sessionStorage.setItem(OUTLOOK_CHECKED_KEY, "1");
        setIsOutlookChecking(false);
      } catch (error) {
        console.error("Failed to check Outlook status:", error);
        setIsOutlookChecking(false);
      }
    };

    checkOutlookConnection();
  }, [user]);

  useEffect(() => {
    async function fetchMetrics() {
      if (!user) return;
      console.log("[Dashboard] Fetching metrics for user:", {
        id: user.$id,
        role: user.role,
        branchIds: user.branchIds,
      });

      try {
        const userIsTeamLead = user.role === "team_lead";

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
        console.log("[Dashboard] Active leads count:", activeLeads.length);
        console.log("[Dashboard] Closed leads count:", closedLeads.length);

        // All dashboard consumers need the same unique lead id list.
        const visibleLeadIds = Array.from(
          new Set([...activeLeads, ...closedLeads].map((lead) => lead.$id)),
        );

        setDashboardInsightsLoading(true);
        try {
          const [userService, branchService] = await Promise.all([
            import("@/lib/services/user-service"),
            import("@/lib/services/branch-service"),
          ]);
          let usersForInsights: User[] = [user];

          if (isAdmin || isReadOnlyAdminView || isManager || isAssistantManager) {
            const visibleUsers = await userService.getAssignableUsers(
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
          } else if (userIsTeamLead) {
            const agents = await userService.getAgentsByTeamLead(user.$id);
            usersForInsights = [user, ...agents];
            // Pre-fetch all branches once and build a lookup map so we don't
            // hit the database N-times-per-agent inside the loop.
            const allBranchesForTeam = await branchService.listBranches();
            const branchNameById = new Map(
              allBranchesForTeam.map((b) => [b.$id, b.name] as const),
            );
            const agentsWithBranches = agents.map((agent) => {
              if (!agent.branchIds || agent.branchIds.length === 0) {
                return { ...agent, branchNames: "N/A" };
              }
              const names = agent.branchIds
                .map((bid) => branchNameById.get(bid))
                .filter((name): name is string => Boolean(name));
              return {
                ...agent,
                branchNames: names.length > 0 ? names.join(", ") : "Unknown",
              };
            });

            setAssignedAgents(agentsWithBranches);
          }

          usersForInsights = await resolveLeadUsersForInsights({
            leads: [...activeLeads, ...closedLeads],
            users: usersForInsights,
            getUserByIdOrNull: userService.getUserByIdOrNull,
          });

          // Reuse the branches we already fetched for the team-lead table
          // when applicable; otherwise fetch them now.
          const allBranches = await branchService.listBranches();
          const branchIdsInScope = new Set([
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
          const branchesForInsights: Branch[] = allBranches.filter(
            (branch) => isAdmin || isReadOnlyAdminView || branchIdsInScope.has(branch.$id),
          );

          // visibleLeadIds is hoisted above this try block; reuse it here.
          const paymentSummaries = visibleLeadIds.length > 0
            ? await listClientPaymentSummariesAction({ actorId: user.$id, leadIds: visibleLeadIds })
            : [];

          setDashboardInsights(
            buildLeadershipDashboardInsights({
              leads: [...activeLeads, ...closedLeads],
              users: usersForInsights,
              branches: branchesForInsights,
              paymentSummaries,
            }),
          );
        } catch (error) {
          console.error("Error fetching dashboard insights:", error);
          setDashboardInsights(null);
        } finally {
          setDashboardInsightsLoading(false);
        }

        // visibleLeadIds is hoisted above the try block; reuse it here.
        const [mockAttempts, interviewAttempts, assessmentAttempts] =
          visibleLeadIds.length > 0
            ? await Promise.all([
                getMockAttempts(user.$id, visibleLeadIds),
                getInterviewAttempts(user.$id, visibleLeadIds),
                getAssessmentAttempts(user.$id, visibleLeadIds),
              ])
            : [[], [], []];

        const countCreatedRequests = (
          attempts: { attemptCount?: number | string }[],
        ) =>
          attempts.reduce((total, attempt) => {
            const count =
              typeof attempt.attemptCount === "number"
                ? attempt.attemptCount
                : Number.parseInt(String(attempt.attemptCount ?? 0), 10);

            return total + (Number.isFinite(count) ? count : 0);
          }, 0);

        // Use the lightweight counts action as the primary count source.
        // The action returns uncapped totals (no document payload).
        // Fall back to array length if countsQuery hasn't returned yet.
        const activeCount = countsQuery.data?.active ??
          activeLeads.length;
        const closedCount = countsQuery.data?.closed ??
          closedLeads.length;

        setMetrics({
          activeLeads: activeCount,
          closedLeads: closedCount,
          createdMocks: countCreatedRequests(mockAttempts),
          createdInterviewSupport: countCreatedRequests(interviewAttempts),
          createdAssessmentSupport: countCreatedRequests(assessmentAttempts),
          loading: false,
        });


        // Fetch upfront payment insights for admin-like read roles.
        if (isAdmin || isReadOnlyAdminView) {
          setPaymentInsightsLoading(true);
          try {
            const insights = await listAllPaymentInsightsAction(user.$id);
            setPaymentInsights(insights);
          } catch (err) {
            console.error("Error fetching payment insights:", err);
          } finally {
            setPaymentInsightsLoading(false);
          }
        }
      } catch (error) {
        console.error("Error fetching metrics:", error);
        setMetrics((prev) => ({ ...prev, loading: false }));
        setDashboardInsights(null);
        setDashboardInsightsLoading(false);
      }
    }

    if (user) {
      fetchMetrics();
    }
  }, [user, isAdmin, isAssistantManager, isManager, isReadOnlyAdminView]);


  useEffect(() => {
    async function fetchUserNames() {
      if (!user) return;

      try {
        // The current hierarchy only has Team Lead -> Agent. The legacy
        // Manager / Assistant Manager roles are retired, so we just resolve
        // the team lead's name for the user-info card.
        if (!user.teamLeadId) {
          setTeamLeadName(null);
          return;
        }

        const { databases } = await import("@/lib/appwrite");
        const isNotFoundError = (error: unknown) => {
          if (typeof error !== "object" || error === null) return false;
          const maybe = error as {
            code?: unknown;
            message?: unknown;
            type?: unknown;
          };
          const code = typeof maybe.code === "number" ? maybe.code : null;
          const message =
            typeof maybe.message === "string" ? maybe.message : "";
          const type = typeof maybe.type === "string" ? maybe.type : "";

          return (
            code === 404 ||
            type.includes("not_found") ||
            message.toLowerCase().includes("could not be found") ||
            message.toLowerCase().includes("not found")
          );
        };

        const teamLeadDoc = await databases
          .getDocument(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
            user.teamLeadId,
          )
          .catch((error) => (isNotFoundError(error) ? null : Promise.reject(error)));

        if (teamLeadDoc && typeof teamLeadDoc.name === "string") {
          setTeamLeadName(teamLeadDoc.name);
        } else {
          setTeamLeadName(null);
        }
      } catch (error) {
        console.error("Error fetching user names:", error);
      }
    }

    if (user) {
      fetchUserNames();
    }
  }, [user]);

  const LeadsIcon = appIcons.leads;
  const ClientsIcon = appIcons.clients;
  const MockIcon = appIcons.mock;
  const InterviewSupportIcon = appIcons.interviewSupport;
  const AssessmentSupportIcon = appIcons.assessmentSupport;


  if (!user || isOutlookChecking) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-52" />
          <Skeleton className="mt-3 h-4 w-72" />
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="mt-3 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-5/6" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, {user.name}</p>
      </div>

      {/* Metrics Cards */}
      <div
        id="tour-global-metrics"
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card id="tour-active-leads">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            <LeadsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.activeLeads
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isAgent ? "Assigned to you" : "Total active leads"}
            </p>
          </CardContent>
        </Card>

        <Card id="tour-clients">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clients</CardTitle>
            <ClientsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.closedLeads
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In client records
            </p>
          </CardContent>
        </Card>

        <Card id="tour-created-mocks">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created Mocks</CardTitle>
            <MockIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.createdMocks
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Mock requests sent
            </p>
          </CardContent>
        </Card>

        <Card id="tour-interview-support">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Created Interview Support
            </CardTitle>
            <InterviewSupportIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.createdInterviewSupport
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Interview emails sent
            </p>
          </CardContent>
        </Card>

        <Card id="tour-assessment-support">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Created Assessment Support
            </CardTitle>
            <AssessmentSupportIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.createdAssessmentSupport
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Assessment emails sent
            </p>
          </CardContent>
        </Card>
      </div>

      {(isAdmin || isReadOnlyAdminView || isManager || isAssistantManager) && (
        <div id="tour-leadership-dashboard">
          <LeadershipDashboard
            role={user.role}
            insights={dashboardInsights}
            isLoading={dashboardInsightsLoading || metrics.loading}
          />
        </div>
      )}

      {(isTeamLead || isAgent) && (
        <div id="tour-role-work-dashboard">
          <RoleWorkDashboard
            role={user.role}
            insights={dashboardInsights}
            isLoading={dashboardInsightsLoading || metrics.loading}
          />
        </div>
      )}

      <div id="tour-follow-up-queue">
        <FollowUpQueueCard
          queue={dashboardInsights?.followUpQueue ?? null}
          isLoading={dashboardInsightsLoading || metrics.loading}
        />
      </div>

      {/* Financial Insights */}
      {(isAdmin || isReadOnlyAdminView) && (
        <FinancialInsightsSection
          paymentRecords={paymentInsights}
          isLoading={paymentInsightsLoading}
        />
      )}



      <div
        id="tour-user-quick-actions"
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card id="tour-user-info">
          <CardHeader>
            <CardTitle>Welcome, {user.name}!</CardTitle>
            <CardDescription>
              You are logged in as a{" "}
              {user.role === "team_lead" ? "team lead" : user.role}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm">
                <strong>Email:</strong> {user.email}
              </p>
              <p className="text-sm">
                <strong>Role:</strong>{" "}
                {user.role === "team_lead"
                  ? "Team Lead"
                  : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              </p>
              {teamLeadName && (
                <p className="text-sm">
                  <strong>Team Lead:</strong> {teamLeadName}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {(isAdmin || isReadOnlyAdminView) && (
          <Card>
            <CardHeader>
              <CardTitle>Admin Access</CardTitle>
              <CardDescription>You have full system access</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a {isOperations ? "operations" : isMonitor ? "monitor" : "admin"}, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>{isReadOnlyAdminView ? "View all branches" : "Manage all branches"}</li>
                <li>{isReadOnlyAdminView ? "View users" : "Create and manage users"}</li>
                <li>{isReadOnlyAdminView ? "View configured lead forms" : "Configure lead forms"}</li>
                <li>{isReadOnlyAdminView ? "View access controls" : "Manage access controls"}</li>
                <li>View all leads and clients</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {!isAdmin && isManager && (
          <Card>
            <CardHeader>
              <CardTitle>Manager Access</CardTitle>
              <CardDescription>You have full system access</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a manager, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Create and manage team leads</li>
                <li>Configure lead forms</li>
                <li>Manage access controls</li>
                <li>View all leads</li>
                <li>Access client records and reports</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {isTeamLead && (
          <Card>
            <CardHeader>
              <CardTitle>Team Lead Access</CardTitle>
              <CardDescription>You can manage your team</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a team lead, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Create and manage agents</li>
                <li>View team leads</li>
                <li>Assign and manage leads</li>
                <li>Access client records and reports</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {isAgent && (
          <Card>
            <CardHeader>
              <CardTitle>Agent Access</CardTitle>
              <CardDescription>You have limited system access</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As an agent, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>View assigned leads</li>
                <li>Edit assigned leads</li>
                <li>Close leads (if permitted)</li>
                <li>Access permitted components</li>
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="md:col-span-2 lg:col-span-1">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => router.push("/leads")}>
              View Leads
            </Button>
            {isTeamLead && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push("/linkedin-requests")}>
                Linkedin Request
              </Button>
            )}
            {(isAdmin || isReadOnlyAdminView || isManager || isTeamLead) && (
              <>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push("/users")}>
                  {isReadOnlyAdminView ? "View Users" : "Manage Users"}
                </Button>
                {!isReadOnlyAdminView && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => router.push("/users?action=create")}>
                    Create User
                  </Button>
                )}
              </>
            )}
            {(isAdmin || isManager) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push("/field-management")}>
                Configure Forms
              </Button>
            )}
            {(isAdmin || isReadOnlyAdminView) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push("/branches")}>
                {isReadOnlyAdminView ? "View Branches" : "Manage Branches"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Assigned Agents Section (Team Lead Only) */}
      {isTeamLead && assignedAgents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Agents</CardTitle>
            <CardDescription>Agents assigned to your team</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3 font-semibold text-sm">Name</th>
                    <th className="p-3 font-semibold text-sm">Email</th>
                    <th className="p-3 font-semibold text-sm">Branch</th>
                    <th className="p-3 font-semibold text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedAgentRows}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LeadGenerationDashboardContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<{
    total: number;
    unassigned: number;
    teamAssignments: LeadGenerationTeamAssignmentStat[];
    loading: boolean;
  }>({
    total: 0,
    unassigned: 0,
    teamAssignments: [],
    loading: true,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const leads = await listLeads({ isClosed: false }, user.$id, user.role, user.branchIds);
        const unassigned = leads.filter((lead) => !lead.assignedToId).length;
        const { getUserByIdOrNull } = await import("@/lib/services/user-service");
        const usersById = new Map<string, User>([[user.$id, user]]);
        const userIdsToResolve = new Set(
          leads
            .map((lead) => lead.assignedToId)
            .filter((assignedToId): assignedToId is string => Boolean(assignedToId)),
        );

        for (const userId of Array.from(userIdsToResolve)) {
          const resolvedUser = await getUserByIdOrNull(userId);
          if (!resolvedUser) continue;

          usersById.set(resolvedUser.$id, resolvedUser);
          if (resolvedUser.role === "agent" && resolvedUser.teamLeadId && !usersById.has(resolvedUser.teamLeadId)) {
            const teamLead = await getUserByIdOrNull(resolvedUser.teamLeadId);
            if (teamLead) {
              usersById.set(teamLead.$id, teamLead);
            }
          }
        }

        const teamMap = new Map<string, LeadGenerationTeamAssignmentStat>();
        for (const lead of leads) {
          if (!lead.assignedToId) continue;
          const assignee = usersById.get(lead.assignedToId);
          const teamLeadId =
            assignee?.role === "team_lead"
              ? assignee.$id
              : assignee?.role === "agent"
                ? assignee.teamLeadId
                : null;
          if (!teamLeadId) continue;

          const teamLead = usersById.get(teamLeadId);
          const teamStat = teamMap.get(teamLeadId) ?? {
            teamLeadId,
            teamLeadName: teamLead?.name ?? "Unknown Team Lead",
            assignedLeads: 0,
          };
          teamStat.assignedLeads += 1;
          teamMap.set(teamLeadId, teamStat);
        }

        const teamAssignments = Array.from(teamMap.values()).sort(
          (a, b) => b.assignedLeads - a.assignedLeads || a.teamLeadName.localeCompare(b.teamLeadName),
        );

        if (!cancelled) {
          setStats({ total: leads.length, unassigned, teamAssignments, loading: false });
        }
      } catch {
        if (!cancelled) {
          setStats((prev) => ({ ...prev, loading: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="container mx-auto space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Lead Generation</h1>
          <p className="text-muted-foreground">Create new leads with the basic details and hand them off for assignment.</p>
        </div>
        <div className="flex gap-2">
          {/* Generate Lead button removed, leads are generated through Linkedin Requests */}
          <Button variant="outline" onClick={() => router.push('/settings')}>Profile Settings</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My Generated Leads</CardTitle>
            <CardDescription>Leads created by you (active only).</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-semibold">{stats.loading ? '—' : stats.total}</div>
            <Button variant="outline" onClick={() => router.push('/leads')}>View Leads</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting Assignment</CardTitle>
            <CardDescription>Leads not yet assigned to a team.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.loading ? '—' : stats.unassigned}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Assignment Counts</CardTitle>
          <CardDescription>Active leads you have assigned to each team.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : stats.teamAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads assigned to a team yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3 text-sm font-semibold">Team Lead</th>
                    <th className="p-3 text-sm font-semibold">Assigned Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.teamAssignments.map((team) => (
                    <tr key={team.teamLeadId} className="border-b last:border-0">
                      <td className="p-3 text-sm font-medium">{team.teamLeadName}</td>
                      <td className="p-3 text-sm">{team.assignedLeads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardContent() {
  const { user } = useAuth();

  if (user?.role === 'lead_generation') {
    return <LeadGenerationDashboardContent />;
  }

  return <LegacyDashboardContent />;
}

export default function DashboardPage() {
  return (
    <ProtectedRoute componentKey="dashboard">
      <DashboardContent />
    </ProtectedRoute>
  );
}
