"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { getMockAttempts } from "@/app/actions/mock";
import { getInterviewAttempts } from "@/app/actions/interview";
import { getAssessmentAttempts } from "@/app/actions/assessment";
import { getBranchById } from "@/lib/services/branch-service";
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



function LegacyDashboardContent() {
  const { user, isAdmin, isManager, isAssistantManager, isAgent, isTeamLead, isMonitor } =
    useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    createdMocks: 0,
    createdInterviewSupport: 0,
    createdAssessmentSupport: 0,
    loading: true,
  });

  const [managerName, setManagerName] = useState<string | null>(null);
  const [assistantManagerName, setAssistantManagerName] = useState<
    string | null
  >(null);
  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);
  const [assignedAgents, setAssignedAgents] = useState<AssignedAgent[]>([]);
  const [isOutlookChecking, setIsOutlookChecking] = useState(true);
  const [dashboardInsights, setDashboardInsights] =
    useState<LeadershipDashboardInsights | null>(null);
  const [dashboardInsightsLoading, setDashboardInsightsLoading] =
    useState(false);
  const [paymentInsights, setPaymentInsights] = useState<PaymentInsightRecord[]>([]);
  const [paymentInsightsLoading, setPaymentInsightsLoading] = useState(false);


  // Check Outlook connection status
  useEffect(() => {
    const checkOutlookConnection = async () => {
      try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();

        if (!data.connected) {
          // If not connected, redirect to login
          console.log("Outlook not connected, redirecting to login...");
          window.location.href = "/api/auth/login";
        } else {
          setIsOutlookChecking(false);
        }
      } catch (error) {
        console.error("Failed to check Outlook status:", error);
        setIsOutlookChecking(false);
      }
    };

    if (user) {
      checkOutlookConnection();
    }
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

        setDashboardInsightsLoading(true);
        try {
          const [userService, branchService] = await Promise.all([
            import("@/lib/services/user-service"),
            import("@/lib/services/branch-service"),
          ]);
          let usersForInsights: User[] = [user];

          if (isAdmin || isMonitor || isManager || isAssistantManager) {
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
            const agentsWithBranches = await Promise.all(
              agents.map(async (agent) => {
                if (agent.branchIds && agent.branchIds.length > 0) {
                  try {
                    const branchNames = await Promise.all(
                      agent.branchIds.map(async (bid) => {
                        const branch = await getBranchById(bid);
                        return branch.name;
                      }),
                    );
                    return { ...agent, branchNames: branchNames.join(", ") };
                  } catch {
                    return { ...agent, branchNames: "Unknown" };
                  }
                }
                return { ...agent, branchNames: "N/A" };
              }),
            );

            setAssignedAgents(agentsWithBranches);
          }

          usersForInsights = await resolveLeadUsersForInsights({
            leads: [...activeLeads, ...closedLeads],
            users: usersForInsights,
            getUserByIdOrNull: userService.getUserByIdOrNull,
          });

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
            (branch) => isAdmin || isMonitor || branchIdsInScope.has(branch.$id),
          );

          const visibleLeadIds = Array.from(
            new Set([...activeLeads, ...closedLeads].map((lead) => lead.$id)),
          );

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

        const visibleLeadIds = Array.from(
          new Set([...activeLeads, ...closedLeads].map((lead) => lead.$id)),
        );
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

        setMetrics({
          activeLeads: activeLeads.length,
          closedLeads: closedLeads.length,
          createdMocks: countCreatedRequests(mockAttempts),
          createdInterviewSupport: countCreatedRequests(interviewAttempts),
          createdAssessmentSupport: countCreatedRequests(assessmentAttempts),
          loading: false,
        });


        // Fetch upfront payment insights for admin-like read roles.
        if (isAdmin || isMonitor) {
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
  }, [user, isAdmin, isAssistantManager, isManager, isMonitor]);


  useEffect(() => {
    async function fetchUserNames() {
      if (!user) return;

      try {
        const userIsAgent = user.role === "agent";
        const userIsTeamLead = user.role === "team_lead";
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

        const getUserDocOrNull = async (userId: string) => {
          try {
            return await databases.getDocument(
              process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
              process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
              userId,
            );
          } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
          }
        };

        setManagerName(null);
        setAssistantManagerName(null);
        setTeamLeadName(null);

        // Fetch manager name if user has managerId
        if (user.managerId) {
          const managerDoc = await getUserDocOrNull(user.managerId);
          if (managerDoc && typeof managerDoc.name === "string") {
            setManagerName(managerDoc.name);
          }
        }

        // Check for Assistant Manager in the hierarchy
        // If user is Agent: Team Lead -> Assistant Manager -> Manager
        // If user is Team Lead: Assistant Manager -> Manager
        if (userIsAgent || userIsTeamLead) {
          // Correct approach:
          // 1. Fetch Team Lead (for Agent)
          // 2. Check Team Lead's manager. If AM, display AM.

          if (userIsAgent && user.teamLeadId) {
            const tlDoc = await getUserDocOrNull(user.teamLeadId);
            if (tlDoc?.managerId) {
              const supDoc = await getUserDocOrNull(String(tlDoc.managerId));
              if (
                supDoc?.role === "assistant_manager" &&
                typeof supDoc.name === "string"
              ) {
                setAssistantManagerName(supDoc.name);
              }
            }
          }

          // For Team Lead:
          // Their 'managerId' might be AM or Manager.
          // If they report to AM, managerId is AM.
          // If they report to Manager, managerId is Manager.
          if (userIsTeamLead && user.managerId) {
            const mDoc = await getUserDocOrNull(user.managerId);
            if (mDoc?.role === "assistant_manager") {
              if (typeof mDoc.name === "string") {
                setAssistantManagerName(mDoc.name);
              }
              setManagerName(null);
              if (mDoc.managerId) {
                const bigBoss = await getUserDocOrNull(String(mDoc.managerId));
                if (bigBoss && typeof bigBoss.name === "string") {
                  setManagerName(bigBoss.name);
                }
              }
            }
          }
        }

        // Fetch team lead name if user has teamLeadId
        if (user.teamLeadId) {
          const teamLeadDoc = await getUserDocOrNull(user.teamLeadId);
          if (teamLeadDoc && typeof teamLeadDoc.name === "string") {
            setTeamLeadName(teamLeadDoc.name);
          } else {
            setTeamLeadName(null);
          }
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

      {(isAdmin || isMonitor || isManager || isAssistantManager) && (
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
      {(isAdmin || isMonitor) && (
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
              {assistantManagerName && (
                <p className="text-sm">
                  <strong>Assistant Manager:</strong> {assistantManagerName}
                </p>
              )}
              {managerName && (
                <p className="text-sm">
                  <strong>Manager:</strong> {managerName}
                </p>
              )}
              {teamLeadName && (
                <p className="text-sm">
                  <strong>Team Lead:</strong> {teamLeadName}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {(isAdmin || isMonitor) && (
          <Card>
            <CardHeader>
              <CardTitle>Admin Access</CardTitle>
              <CardDescription>You have full system access</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a {isMonitor ? "monitor" : "admin"}, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>{isMonitor ? "View all branches" : "Manage all branches"}</li>
                <li>{isMonitor ? "View users" : "Create and manage users"}</li>
                <li>{isMonitor ? "View configured lead forms" : "Configure lead forms"}</li>
                <li>{isMonitor ? "View access controls" : "Manage access controls"}</li>
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
            {(isAdmin || isMonitor || isManager || isTeamLead) && (
              <>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push("/users")}>
                  {isMonitor ? "View Users" : "Manage Users"}
                </Button>
                {!isMonitor && (
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
            {(isAdmin || isMonitor) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push("/branches")}>
                {isMonitor ? "View Branches" : "Manage Branches"}
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
                  {assignedAgents.map((agent) => (
                    <tr
                      key={agent.$id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-3 text-sm">{agent.name}</td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {agent.email}
                      </td>
                      <td className="p-3 text-sm">
                        {agent.branchNames || "N/A"}
                      </td>
                      <td className="p-3 text-sm">
                        <span className="inline-flex items-center rounded-full bg-[var(--soft-cloud)] px-3 py-1 text-xs font-medium text-[var(--success)]">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
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
  const [stats, setStats] = useState<{ total: number; unassigned: number; loading: boolean }>({
    total: 0,
    unassigned: 0,
    loading: true,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const leads = await listLeads({ isClosed: false }, user.$id, user.role, user.branchIds);
        const unassigned = leads.filter((lead) => !lead.assignedToId).length;
        if (!cancelled) {
          setStats({ total: leads.length, unassigned, loading: false });
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
            <CardDescription>Leads not yet assigned to an agent.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.loading ? '—' : stats.unassigned}</CardContent>
        </Card>
      </div>
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
