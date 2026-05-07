'use client';

import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  ClipboardList,
  Users,
} from 'lucide-react';
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

interface LeadershipDashboardProps {
  role: UserRole;
  insights: LeadershipDashboardInsights | null;
  isLoading: boolean;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatRoleName(role: UserRole) {
  if (role === 'assistant_manager') return 'Assistant Manager';
  if (role === 'team_lead') return 'Team Lead';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function MetricValue({ value, isLoading }: { value: number | string; isLoading: boolean }) {
  return isLoading ? <Skeleton className="h-8 w-20" /> : value;
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border border-border p-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid grid-cols-6 gap-3">
          <Skeleton className="h-10 w-full" />
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

export function LeadershipDashboard({
  role,
  insights,
  isLoading,
}: LeadershipDashboardProps) {
  const summary = insights?.summary;
  const roleCounts = insights?.roleCounts;
  const branchSummaries = insights?.branchSummaries ?? [];
  const assigneeWorkload = insights?.assigneeWorkload ?? [];
  const statusBreakdown = insights?.statusBreakdown ?? [];
  const roleName = formatRoleName(role);
  const scopeLabel = role === 'admin'
    ? 'all CRM activity'
    : role === 'assistant_manager'
      ? 'your assigned scope'
      : 'your team and branch activity';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Leadership Overview</h2>
        <p className="text-sm text-muted-foreground">
          {roleName} view for {scopeLabel}. Leads and Current Clients pages stay unchanged.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Work</CardTitle>
            <BriefcaseBusiness className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MetricValue value={summary?.activeLeads ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Active leads in scope</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attention Needed</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MetricValue value={summary?.staleLeads ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">No update for 14+ days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unassigned</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MetricValue value={summary?.unassignedLeads ?? 0} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Active leads without owner action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pipeline Value</CardTitle>
            <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MetricValue value={currencyFormatter.format(summary?.totalPipelineValue ?? 0)} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {currencyFormatter.format(summary?.closedRevenue ?? 0)} closed revenue
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Team Workload</CardTitle>
            <CardDescription>Top assigned users by active lead volume.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton />
            ) : assigneeWorkload.length === 0 ? (
              <div className="text-sm text-muted-foreground">No workload data available yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="p-3 text-sm font-semibold">User</th>
                      <th className="p-3 text-sm font-semibold">Role</th>
                      <th className="p-3 text-sm font-semibold">Active</th>
                      <th className="p-3 text-sm font-semibold">Clients</th>
                      <th className="p-3 text-sm font-semibold">Stale</th>
                      <th className="p-3 text-sm font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigneeWorkload.slice(0, 8).map((workload) => (
                      <tr key={workload.userId} className="border-b last:border-0">
                        <td className="p-3 text-sm font-medium">{workload.userName}</td>
                        <td className="p-3 text-sm text-muted-foreground">{formatRoleName(workload.role)}</td>
                        <td className="p-3 text-sm">{workload.activeLeads}</td>
                        <td className="p-3 text-sm">{workload.closedLeads}</td>
                        <td className="p-3 text-sm">{workload.staleLeads}</td>
                        <td className="p-3 text-sm">{currencyFormatter.format(workload.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Shape
            </CardTitle>
            <CardDescription>People visible in this dashboard scope.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['Managers', roleCounts?.managers ?? 0],
              ['Assistant Managers', roleCounts?.assistantManagers ?? 0],
              ['Team Leads', roleCounts?.teamLeads ?? 0],
              ['Agents', roleCounts?.agents ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold">
                  {isLoading ? <Skeleton className="h-4 w-8" /> : value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Branch Health
            </CardTitle>
            <CardDescription>Branch-level lead pressure and closed value.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ListSkeleton />
            ) : branchSummaries.length === 0 ? (
              <div className="text-sm text-muted-foreground">No branch activity available yet.</div>
            ) : (
              <div className="space-y-3">
                {branchSummaries.slice(0, 6).map((branch) => (
                  <div key={branch.branchId} className="border border-border bg-[var(--soft-cloud)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{branch.branchName}</p>
                        <p className="text-xs text-muted-foreground">
                          {branch.activeLeads} active, {branch.closedLeads} clients
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{currencyFormatter.format(branch.totalValue)}</p>
                        <p className="text-xs text-muted-foreground">{currencyFormatter.format(branch.closedValue)} closed</p>
                      </div>
                    </div>
                    {(branch.staleLeads > 0 || branch.unassignedLeads > 0) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {branch.staleLeads} stale, {branch.unassignedLeads} unassigned
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Status Mix
            </CardTitle>
            <CardDescription>Current spread of lead and client statuses.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ListSkeleton />
            ) : statusBreakdown.length === 0 ? (
              <div className="text-sm text-muted-foreground">No status data available yet.</div>
            ) : (
              <div className="space-y-3">
                {statusBreakdown.map((item) => (
                  <div key={item.status} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                    <span className="text-sm">{item.status}</span>
                    <span className="text-sm font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
