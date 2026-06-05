'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  DashboardLeadDetailRow,
  LeadershipDashboardInsights,
} from '@/lib/utils/dashboard-insights';
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
  if (role === 'team_lead') return 'Team Lead';
  if (role === 'lead_generation') return 'Lead Generation';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function MetricValue({ value, isLoading }: { value: number | string; isLoading: boolean }) {
  return isLoading ? <Skeleton className="h-8 w-20" /> : value;
}

type DrillDownKey = keyof LeadershipDashboardInsights['details'];

interface DrillDownConfig {
  key: DrillDownKey;
  title: string;
  description: string;
}

const drillDownCopy: Record<DrillDownKey, Omit<DrillDownConfig, 'key'>> = {
  activeLeads: {
    title: 'Open Work',
    description: 'Open lead records behind this dashboard number.',
  },
  closedLeads: {
    title: 'Clients',
    description: 'Closed client records behind this dashboard number.',
  },
  unassignedLeads: {
    title: 'Unassigned',
    description: 'Active leads that do not have an assigned user.',
  },
  staleLeads: {
    title: 'Attention Needed',
    description: 'Active leads without an update for 14 or more days.',
  },
  pipelineValue: {
    title: 'Pipeline Value',
    description: 'Lead and client records contributing to total value.',
  },
  upfrontCollectedLeads: {
    title: 'Upfront Collected',
    description: 'Clients who have paid partially or fully upfront.',
  },
  fullyPaidLeads: {
    title: 'Fully Paid',
    description: 'Clients who have completed their full upfront payment.',
  },
};

function formatDate(value: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
}

function AdminLeadDrillDownDialog({
  config,
  rows,
  onOpenChange,
}: {
  config: DrillDownConfig | null;
  rows: DashboardLeadDetailRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) => (
      row.leadName.toLowerCase().includes(query) ||
      row.company.toLowerCase().includes(query) ||
      row.email.toLowerCase().includes(query) ||
      row.status.toLowerCase().includes(query) ||
      row.branchName.toLowerCase().includes(query) ||
      row.ownerName.toLowerCase().includes(query) ||
      row.assignedToName.toLowerCase().includes(query)
    ));
  }, [rows, search]);

  return (
    <Dialog open={Boolean(config)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>{config?.title ?? 'Dashboard Data'}</DialogTitle>
          <DialogDescription>
            {config?.description ?? 'Full dashboard records.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-hidden px-6 pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search records..."
              className="max-w-sm"
            />
            <p className="text-sm text-muted-foreground">
              {filteredRows.length} of {rows.length} records
            </p>
          </div>
          <div className="max-h-[58vh] overflow-auto border border-border">
            <Table>
              <TableHeader>
                <TableRow className="cursor-default hover:bg-transparent">
                  <TableHead>Lead</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow className="cursor-default hover:bg-transparent">
                    <TableCell colSpan={8} className="text-muted-foreground">
                      No matching records.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => (
                    <TableRow
                      key={row.leadId}
                      onClick={() => router.push(row.isClosed ? `/client/${row.leadId}` : `/leads/${row.leadId}`)}
                    >
                      <TableCell className="font-medium">{row.leadName}</TableCell>
                      <TableCell>{row.company || 'N/A'}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>{row.branchName}</TableCell>
                      <TableCell>{row.ownerName}</TableCell>
                      <TableCell>{row.assignedToName}</TableCell>
                      <TableCell className="text-right">{currencyFormatter.format(row.amount)}</TableCell>
                      <TableCell>{formatDate(row.updatedAt ?? row.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const [selectedDrillDown, setSelectedDrillDown] = useState<DrillDownConfig | null>(null);
  const summary = insights?.summary;
  const roleCounts = insights?.roleCounts;
  const branchSummaries = insights?.branchSummaries ?? [];
  const assigneeWorkload = insights?.assigneeWorkload ?? [];
  const statusBreakdown = insights?.statusBreakdown ?? [];
  const roleName = formatRoleName(role);
  const scopeLabel = role === 'admin' || role === 'developer'
    ? 'all CRM activity'
    : 'your team and branch activity';
  const openDrillDown = (key: DrillDownKey) => {
    if (isLoading || !insights) return;
    setSelectedDrillDown({ key, ...drillDownCopy[key] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Leadership Overview</h2>
        <p className="text-sm text-muted-foreground">
          {roleName} view for {scopeLabel}. Leads and Current Clients pages stay unchanged.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => openDrillDown('activeLeads')} className="block w-full text-left">
        <Card className="h-full transition-colors hover:border-foreground/40 hover:bg-accent">
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
        </button>

        <button type="button" onClick={() => openDrillDown('staleLeads')} className="block w-full text-left">
        <Card className="h-full transition-colors hover:border-foreground/40 hover:bg-accent">
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
        </button>

        <button type="button" onClick={() => openDrillDown('unassignedLeads')} className="block w-full text-left">
        <Card className="h-full transition-colors hover:border-foreground/40 hover:bg-accent">
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
        </button>

        <button type="button" onClick={() => openDrillDown('upfrontCollectedLeads')} className="block w-full text-left">
        <Card className="h-full transition-colors hover:border-foreground/40 hover:bg-accent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upfront Collected</CardTitle>
            <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MetricValue value={currencyFormatter.format(summary?.totalUpfrontValue ?? 0)} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  openDrillDown('fullyPaidLeads');
                }}
                className="hover:text-foreground hover:underline transition-colors cursor-pointer"
              >
                {currencyFormatter.format(summary?.fullyPaidUpfrontValue ?? 0)} fully paid
              </span>
            </p>
          </CardContent>
        </Card>
        </button>
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
              ['Team Leads', roleCounts?.teamLeads ?? 0],
              ['Agents', roleCounts?.agents ?? 0],
              ['Lead Generation', roleCounts?.leadGeneration ?? 0],
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
      <AdminLeadDrillDownDialog
        config={selectedDrillDown}
        rows={selectedDrillDown && insights ? insights.details[selectedDrillDown.key] : []}
        onOpenChange={(open) => {
          if (!open) setSelectedDrillDown(null);
        }}
      />
    </div>
  );
}
