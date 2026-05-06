'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ProtectedRoute } from '@/components/protected-route';
import { listLeadsAction } from '@/app/actions/lead';
import { getMockAttempts } from '@/app/actions/mock';
import { getInterviewAttempts } from '@/app/actions/interview';
import { getAssessmentAttempts } from '@/app/actions/assessment';
import { getBranchById } from '@/lib/services/branch-service';
import { Skeleton } from '@/components/ui/skeleton';
import type { User } from '@/lib/types';
import { DollarSign, TrendingUp } from 'lucide-react';
import { appIcons } from '@/components/navigation-config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type AmountChartDatum = {
  name: string;
  Total: number;
  Net: number;
};

type AssignedAgent = User & {
  branchNames: string;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function parseCurrencyAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const normalizedValue = value.replace(/[^0-9.-]/g, '');
  if (!normalizedValue) {
    return 0;
  }

  const parsedValue = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function getLeadAmount(leadData: Record<string, unknown>): number {
  return parseCurrencyAmount(leadData.amount ?? leadData.dealValue ?? 0);
}

function getMetricDate(lead: { isClosed: boolean; closedAt: string | null; $createdAt?: string; $updatedAt?: string }) {
  const candidateDates = lead.isClosed
    ? [lead.closedAt, lead.$updatedAt, lead.$createdAt]
    : [lead.$createdAt, lead.$updatedAt];

  for (const candidateDate of candidateDates) {
    if (!candidateDate) {
      continue;
    }

    const parsedDate = new Date(candidateDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  return new Date();
}

function DashboardContent() {
  const { user, isAdmin, isManager, isAgent, isTeamLead } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    createdMocks: 0,
    createdInterviewSupport: 0,
    createdAssessmentSupport: 0,
    totalAmount: 0,
    netAmount: 0,
    loading: true,
  });
  const [amountData, setAmountData] = useState<AmountChartDatum[]>([]);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [assistantManagerName, setAssistantManagerName] = useState<string | null>(null);
  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);
  const [assignedAgents, setAssignedAgents] = useState<AssignedAgent[]>([]);
  const [isOutlookChecking, setIsOutlookChecking] = useState(true);
  const [financialView, setFinancialView] = useState<'total' | 'monthly'>('total');
  const [selectedMonth, setSelectedMonth] = useState('');

  // Check Outlook connection status
  useEffect(() => {
    const checkOutlookConnection = async () => {
      try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();

        if (!data.connected) {
          // If not connected, redirect to login
          console.log('Outlook not connected, redirecting to login...');
          window.location.href = '/api/auth/login';
        } else {
          setIsOutlookChecking(false);
        }
      } catch (error) {
        console.error('Failed to check Outlook status:', error);
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
      console.log('[Dashboard] Fetching metrics for user:', { id: user.$id, role: user.role, branchIds: user.branchIds });

      try {
        const userIsTeamLead = user.role === 'team_lead';

        const [activeLeads, closedLeads] = await Promise.all([
          listLeadsAction(
            { isClosed: false },
            user.$id,
            user.role,
            user.branchIds
          ),
          listLeadsAction(
            { isClosed: true },
            user.$id,
            user.role,
            user.branchIds
          ),
        ]);
        console.log('[Dashboard] Active leads count:', activeLeads.length);
        console.log('[Dashboard] Closed leads count:', closedLeads.length);

        // Fetch assigned agents for the team lead detail table.
        if (userIsTeamLead) {
            const { getAgentsByTeamLead } = await import('@/lib/services/user-service');
            const agents = await getAgentsByTeamLead(user.$id);

            // Fetch branch names for each agent
            const agentsWithBranches = await Promise.all(agents.map(async (agent) => {
              if (agent.branchIds && agent.branchIds.length > 0) {
                // Assuming we want to show the first branch or join them
                // For simplicity, let's fetch the first branch name
                try {
                    const branchNames = await Promise.all(agent.branchIds.map(async (bid) => {
                        const branch = await getBranchById(bid);
                        return branch.name;
                    }));
                    return { ...agent, branchNames: branchNames.join(', ') };
                } catch {
                    return { ...agent, branchNames: 'Unknown' };
                }
              }
              return { ...agent, branchNames: 'N/A' };
            }));

            setAssignedAgents(agentsWithBranches);
        }

        const visibleLeadIds = Array.from(
          new Set([...activeLeads, ...closedLeads].map((lead) => lead.$id))
        );
        const [mockAttempts, interviewAttempts, assessmentAttempts] = visibleLeadIds.length > 0
          ? await Promise.all([
              getMockAttempts(user.$id, visibleLeadIds),
              getInterviewAttempts(user.$id, visibleLeadIds),
              getAssessmentAttempts(user.$id, visibleLeadIds),
            ])
          : [[], [], []];

        const countCreatedRequests = (attempts: { attemptCount?: number | string }[]) =>
          attempts.reduce((total, attempt) => {
            const count = typeof attempt.attemptCount === 'number'
              ? attempt.attemptCount
              : Number.parseInt(String(attempt.attemptCount ?? 0), 10);

            return total + (Number.isFinite(count) ? count : 0);
          }, 0);

        // Calculate Amounts (Total and Net)
        let totalAmount = 0;
        let netAmount = 0;
        const monthlyData: Record<string, { total: number; net: number; monthStart: number }> = {};

        // Total deal value includes both open leads and closed clients.
        // Net revenue only includes closed clients.
        [...activeLeads, ...closedLeads].forEach(lead => {
            let leadData: Record<string, unknown>;
            try {
                leadData = JSON.parse(lead.data) as Record<string, unknown>;
            } catch { return; }

            const amount = getLeadAmount(leadData);

            if (amount <= 0) {
                return;
            }

            totalAmount += amount;

            const metricDate = getMetricDate(lead);
            const monthKey = metricDate.toLocaleString('default', { month: 'short', year: 'numeric' });
            const monthStart = new Date(metricDate.getFullYear(), metricDate.getMonth(), 1).getTime();

            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { total: 0, net: 0, monthStart };
            }

            monthlyData[monthKey].total += amount;

            if (lead.isClosed) {
                netAmount += amount;
                monthlyData[monthKey].net += amount;
            }
        });

        // Format chart data
        const chartData = Object.entries(monthlyData)
          .map(([name, data]) => ({
            name,
            Total: data.total,
            Net: data.net,
            monthStart: data.monthStart,
          }))
          .sort((a, b) => a.monthStart - b.monthStart)
          .map((data) => ({
            name: data.name,
            Total: data.Total,
            Net: data.Net,
          }));

        setMetrics({
          activeLeads: activeLeads.length,
          closedLeads: closedLeads.length,
          createdMocks: countCreatedRequests(mockAttempts),
          createdInterviewSupport: countCreatedRequests(interviewAttempts),
          createdAssessmentSupport: countCreatedRequests(assessmentAttempts),
          totalAmount,
          netAmount,
          loading: false,
        });
        setAmountData(chartData);
      } catch (error) {
        console.error('Error fetching metrics:', error);
        setMetrics((prev) => ({ ...prev, loading: false }));
      }
    }

    if (user) {
      fetchMetrics();
    }
  }, [user]);

  useEffect(() => {
    async function fetchUserNames() {
      if (!user) return;

      try {
        const userIsAgent = user.role === 'agent';
        const userIsTeamLead = user.role === 'team_lead';
        const { databases } = await import('@/lib/appwrite');

        setManagerName(null);
        setAssistantManagerName(null);
        setTeamLeadName(null);

        // Fetch manager name if user has managerId
        if (user.managerId) {
          try {
              const managerDoc = await databases.getDocument(
                process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
                user.managerId
              );
              setManagerName(managerDoc.name);
          } catch {
              console.warn("Could not fetch manager details");
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
                  try {
                      const tlDoc = await databases.getDocument(
                          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                         process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
                         user.teamLeadId
                     );
                     // If TL's manager is AM
                     if (tlDoc.managerId) {
                         const supDoc = await databases.getDocument(
                             process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                             process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
                             tlDoc.managerId
                         );
                         if (supDoc.role === 'assistant_manager') {
                             setAssistantManagerName(supDoc.name);
                         }
                     }
                  } catch {}
              }

             // For Team Lead:
              // Their 'managerId' might be AM or Manager.
              // If they report to AM, managerId is AM.
              // If they report to Manager, managerId is Manager.
              if (userIsTeamLead && user.managerId) {
                   try {
                       const mDoc = await databases.getDocument(
                           process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
                          user.managerId
                      );
                      if (mDoc.role === 'assistant_manager') {
                          setAssistantManagerName(mDoc.name);
                          setManagerName(null); // Clear manager name if it's actually AM, to avoid duplication or confusion?
                          // Wait, we want to show BOTH if possible.
                          // If TL -> AM -> Manager.
                          // TL.managerId = AM.
                          // AM.managerId = Manager.

                          // So we fetched AM.
                          // Now fetch AM's manager to get the "Big Manager".
                          if (mDoc.managerId) {
                              const bigBoss = await databases.getDocument(
                                  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                                  process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
                                  mDoc.managerId
                              );
                              setManagerName(bigBoss.name);
                          }
                      }
                   } catch {}
              }
        }

        // Fetch team lead name if user has teamLeadId
        if (user.teamLeadId) {
          const teamLeadDoc = await databases.getDocument(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
            user.teamLeadId
          );
          setTeamLeadName(teamLeadDoc.name);
        }
      } catch (error) {
        console.error('Error fetching user names:', error);
      }
    }

    if (user) {
      fetchUserNames();
    }
  }, [user]);

  useEffect(() => {
    if (amountData.length === 0) {
      setSelectedMonth('');
      return;
    }

    const monthStillExists = amountData.some((dataPoint) => dataPoint.name === selectedMonth);
    if (!selectedMonth || !monthStillExists) {
      setSelectedMonth(amountData[amountData.length - 1].name);
    }
  }, [amountData, selectedMonth]);

  const selectedMonthData = amountData.find((dataPoint) => dataPoint.name === selectedMonth) ?? null;
  const isMonthlyView = financialView === 'monthly';
  const displayedTotalAmount = isMonthlyView && selectedMonthData ? selectedMonthData.Total : metrics.totalAmount;
  const displayedNetAmount = isMonthlyView && selectedMonthData ? selectedMonthData.Net : metrics.netAmount;
  const displayedChartData = isMonthlyView && selectedMonthData ? [selectedMonthData] : amountData;
  const displayedPeriodLabel = isMonthlyView
    ? (selectedMonthData?.name ?? 'Selected month')
    : 'All time';
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
        <p className="text-muted-foreground mt-1">
          Welcome back, {user.name}
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            <LeadsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.activeLeads}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isAgent ? 'Assigned to you' : 'Total active leads'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clients</CardTitle>
            <ClientsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.closedLeads}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In client records
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created Mocks</CardTitle>
            <MockIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.createdMocks}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Mock requests sent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created Interview Support</CardTitle>
            <InterviewSupportIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.createdInterviewSupport}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Interview emails sent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created Assessment Support</CardTitle>
            <AssessmentSupportIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.createdAssessmentSupport}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Assessment emails sent
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Amount Insights Graph (Admin Only) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Financial Insights</CardTitle>
            <CardDescription>Total deal value includes leads and clients. Net revenue includes clients only.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={financialView === 'total' ? 'default' : 'outline'}
                  onClick={() => setFinancialView('total')}
                  type="button"
                >
                  Total
                </Button>
                <Button
                  variant={financialView === 'monthly' ? 'default' : 'outline'}
                  onClick={() => setFinancialView('monthly')}
                  type="button"
                >
                  Monthly
                </Button>
              </div>

              {financialView === 'monthly' && (
                <div className="flex items-center gap-2">
                  <label htmlFor="financial-month" className="text-sm text-muted-foreground">
                    Month
                  </label>
                  <select
                    id="financial-month"
                    className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={selectedMonth}
                    onChange={(event) => setSelectedMonth(event.target.value)}
                    disabled={amountData.length === 0}
                  >
                    {amountData.length === 0 ? (
                      <option value="">No data</option>
                    ) : (
                      amountData.map((dataPoint) => (
                        <option key={dataPoint.name} value={dataPoint.name}>
                          {dataPoint.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="flex flex-col gap-1 p-4 border rounded-lg bg-card shadow-sm">
                    <span className="text-sm font-medium text-muted-foreground">
                      Period
                    </span>
                    <span className="text-2xl font-bold">{displayedPeriodLabel}</span>
                </div>
                <div className="flex flex-col gap-1 p-4 border rounded-lg bg-card shadow-sm">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <DollarSign className="h-4 w-4" /> {isMonthlyView ? 'Monthly Deal Value' : 'Total Deal Value'}
                    </span>
                    <span className="text-2xl font-bold">{currencyFormatter.format(displayedTotalAmount)}</span>
                </div>
                <div className="flex flex-col gap-1 p-4 border rounded-lg bg-card shadow-sm">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> {isMonthlyView ? 'Monthly Net Revenue' : 'Net Revenue'}
                    </span>
                    <span className="text-2xl font-bold text-green-600">{currencyFormatter.format(displayedNetAmount)}</span>
                </div>
            </div>

            <div className="h-[300px] w-full">
                {displayedChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displayedChartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#30302e" />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: '#87867f', fontSize: 12 }}
                          axisLine={{ stroke: '#30302e' }}
                          tickLine={false}
                        />
                        <YAxis
                          width={72}
                          tick={{ fill: '#87867f', fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value: number) => {
                            if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
                            if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
                            return `$${value}`;
                          }}
                        />
                        <Tooltip
                            formatter={(value) => [currencyFormatter.format(Number(value)), '']}
                            contentStyle={{
                              backgroundColor: '#30302e',
                              borderColor: '#3d3d3a',
                              borderRadius: '0.5rem',
                              color: '#faf9f5',
                              fontSize: '0.875rem',
                            }}
                            labelStyle={{ color: '#b0aea5', marginBottom: '0.25rem' }}
                            cursor={{ fill: 'rgba(201,100,66,0.06)' }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '0.8125rem', color: '#87867f', paddingTop: '0.5rem' }}
                        />
                        <Bar dataKey="Total" fill="#c96442" name="Total Deal Value" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Net" fill="#d97757" name="Net Revenue" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[#30302e] text-sm text-[#87867f]">
                    No financial data available yet.
                  </div>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Info and Quick Actions */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {user.name}!</CardTitle>
            <CardDescription>
              You are logged in as a {user.role === 'team_lead' ? 'team lead' : user.role}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm">
                <strong>Email:</strong> {user.email}
              </p>
              <p className="text-sm">
                <strong>Role:</strong> {user.role === 'team_lead' ? 'Team Lead' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
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

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Admin Access</CardTitle>
              <CardDescription>
                You have full system access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As an admin, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Manage all branches</li>
                <li>Create and manage users</li>
                <li>Configure lead forms</li>
                <li>Manage access controls</li>
                <li>View all leads and clients</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {!isAdmin && isManager && (
          <Card>
            <CardHeader>
              <CardTitle>Manager Access</CardTitle>
              <CardDescription>
                You have full system access
              </CardDescription>
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
              <CardDescription>
                You can manage your team
              </CardDescription>
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
              <CardDescription>
                You have limited system access
              </CardDescription>
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
            <CardDescription>
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => router.push('/leads')}
            >
              View Leads
            </Button>
            {(isAdmin || isManager || isTeamLead) && (
              <>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push('/users')}
                >
                  Manage Users
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push('/users?action=create')}
                >
                  Create User
                </Button>
              </>
            )}
            {(isAdmin || isManager) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/field-management')}
              >
                Configure Forms
              </Button>
            )}
            {isAdmin && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/branches')}
              >
                Manage Branches
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
            <CardDescription>
              Agents assigned to your team
            </CardDescription>
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
                    <tr key={agent.$id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-3 text-sm">{agent.name}</td>
                      <td className="p-3 text-sm text-muted-foreground">{agent.email}</td>
                      <td className="p-3 text-sm">{agent.branchNames || 'N/A'}</td>
                      <td className="p-3 text-sm">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
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

export default function DashboardPage() {
  return (
    <ProtectedRoute componentKey="dashboard">
      <DashboardContent />
    </ProtectedRoute>
  );
}
