'use client';

import { CheckCircle2, Clock3, FileText, UserCheck } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { LeadershipDashboardInsights } from '@/lib/utils/dashboard-insights';
import type { UserRole } from '@/lib/types';

interface RoleWorkDashboardProps {
  role: UserRole;
  insights: LeadershipDashboardInsights | null;
  isLoading: boolean;
}

function roleLabel(role: UserRole) {
  if (role === 'team_lead') return 'Team Lead';
  if (role === 'assistant_manager') return 'Assistant Manager';
  if (role === 'lead_generation') return 'Lead Generation';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function ValueOrSkeleton({ value, isLoading }: { value: number; isLoading: boolean }) {
  return isLoading ? <Skeleton className="h-8 w-16" /> : value;
}

function AgentWorkloadSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid grid-cols-5 gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export function RoleWorkDashboard({ role, insights, isLoading }: RoleWorkDashboardProps) {
  const summary = insights?.summary;
  const isTeamLead = role === 'team_lead';
  const title = isTeamLead ? 'My Team Today' : 'My Work Today';
  const description = isTeamLead
    ? 'Daily operating view for your assigned agents and lead follow-ups.'
    : 'Your assigned lead work, follow-ups, and active opportunities.';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {description} Leads and Current Clients pages stay unchanged.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <ValueOrSkeleton value={summary?.activeLeads ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isTeamLead ? 'Team active leads' : 'Assigned or created by you'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Due Today</CardTitle>
            <Clock3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <ValueOrSkeleton value={summary?.dueTodayFollowUps ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Follow-ups scheduled today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <ValueOrSkeleton value={summary?.overdueFollowUps ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Follow-ups needing attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clients</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <ValueOrSkeleton value={summary?.closedLeads ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Closed client records in scope</p>
          </CardContent>
        </Card>
      </div>

      {isTeamLead && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Workload</CardTitle>
            <CardDescription>Active lead pressure across your team.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <AgentWorkloadSkeleton />
            ) : !insights?.assigneeWorkload.length ? (
              <p className="text-sm text-muted-foreground">No agent workload data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="p-3 text-sm font-semibold">Name</th>
                      <th className="p-3 text-sm font-semibold">Role</th>
                      <th className="p-3 text-sm font-semibold">Active</th>
                      <th className="p-3 text-sm font-semibold">Stale</th>
                      <th className="p-3 text-sm font-semibold">Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.assigneeWorkload.map((item) => (
                      <tr key={item.userId} className="border-b last:border-0">
                        <td className="p-3 text-sm font-medium">{item.userName}</td>
                        <td className="p-3 text-sm text-muted-foreground">{roleLabel(item.role)}</td>
                        <td className="p-3 text-sm">{item.activeLeads}</td>
                        <td className="p-3 text-sm">{item.staleLeads}</td>
                        <td className="p-3 text-sm">{item.closedLeads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
