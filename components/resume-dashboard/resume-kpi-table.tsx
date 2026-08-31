'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ResumeDashboardData } from '@/app/actions/resume-dashboard';
import { Skeleton } from '@/components/ui/skeleton';

interface ResumeKpiTableProps {
  kpiRows?: ResumeDashboardData['kpiRows'];
  loading?: boolean;
}

export function ResumeKpiTable({ kpiRows, loading }: ResumeKpiTableProps) {
  return (
    <Card className="col-span-1 lg:col-span-2 shadow-sm border-slate-200 dark:border-slate-800">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
        <CardTitle>Team Performance (KPI)</CardTitle>
        <CardDescription>Activity within the selected date range</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {loading || !kpiRows ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Created / Assigned</TableHead>
                  <TableHead className="text-right">Moved to Marketing</TableHead>
                  <TableHead className="text-right">Avg Time to Mkt</TableHead>
                  <TableHead className="text-right">Pending Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpiRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No team data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  kpiRows.map((row) => (
                    <TableRow key={row.agentId}>
                      <TableCell className="font-medium">{row.agentName}</TableCell>
                      <TableCell className="text-right">{row.profilesAssigned}</TableCell>
                      <TableCell className="text-right text-blue-600 font-medium">{row.profilesMovedToMarketing}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.avgTimeToMarketing > 0 ? `${row.avgTimeToMarketing} days` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-orange-500 font-medium">
                        {row.compliancePending > 0 ? row.compliancePending : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
