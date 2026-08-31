'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, FileText, CheckCircle, BarChart3 } from 'lucide-react';
import type { ResumeDashboardData } from '@/app/actions/resume-dashboard';
import { Skeleton } from '@/components/ui/skeleton';

interface ResumeTopMetricsProps {
  metrics?: ResumeDashboardData['topMetrics'];
  loading?: boolean;
}

export function ResumeTopMetrics({ metrics, loading }: ResumeTopMetricsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-background border-blue-100 dark:border-blue-900/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-300">Total Active Profiles</CardTitle>
          <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-full">
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </CardHeader>
        <CardContent>
          {loading || !metrics ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <div className="text-3xl font-bold text-blue-950 dark:text-blue-100">{metrics.totalActive}</div>
          )}
          <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-1">Excludes Placed & Closed</p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-background border-amber-100 dark:border-amber-900/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-300">In Formatting</CardTitle>
          <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-full">
            <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
        </CardHeader>
        <CardContent>
          {loading || !metrics ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <div className="text-3xl font-bold text-amber-950 dark:text-amber-100">{metrics.inFormatting}</div>
          )}
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">Stage: 2. Formatting</p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-background border-purple-100 dark:border-purple-900/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-purple-800 dark:text-purple-300">In Marketing</CardTitle>
          <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-full">
            <BarChart3 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
        </CardHeader>
        <CardContent>
          {loading || !metrics ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <div className="text-3xl font-bold text-purple-950 dark:text-purple-100">{metrics.inMarketing}</div>
          )}
          <p className="text-xs text-purple-600/80 dark:text-purple-400/80 mt-1">Ready for market</p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/20 dark:to-background border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Profiles Placed</CardTitle>
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-full">
            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        </CardHeader>
        <CardContent>
          {loading || !metrics ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <div className="text-3xl font-bold text-emerald-950 dark:text-emerald-100">{metrics.placed}</div>
          )}
          <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">Total successes</p>
        </CardContent>
      </Card>
    </div>
  );
}
