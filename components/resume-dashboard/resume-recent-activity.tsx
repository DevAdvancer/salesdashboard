'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Megaphone, ShieldCheck, Clock } from 'lucide-react';
import type { ResumeDashboardData } from '@/app/actions/resume-dashboard';
import { formatDistanceToNow } from 'date-fns';

interface ResumeRecentActivityProps {
  activities?: ResumeDashboardData['recentActivities'];
  loading?: boolean;
}

export function ResumeRecentActivity({ activities, loading }: ResumeRecentActivityProps) {
  return (
    <Card className="col-span-1 shadow-sm border-slate-200 dark:border-slate-800">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest team actions</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {loading || !activities ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No recent activity found.
          </div>
        ) : (
          <div className="space-y-6">
            {activities.map((activity) => {
              let Icon = FileText;
              let iconBg = 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
              let description = '';

              switch (activity.type) {
                case 'created':
                  Icon = FileText;
                  iconBg = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
                  description = 'created profile for';
                  break;
                case 'marketing':
                  Icon = Megaphone;
                  iconBg = 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
                  description = 'moved to Marketing:';
                  break;
                case 'compliance_approved':
                  Icon = ShieldCheck;
                  iconBg = 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
                  description = 'compliance approved:';
                  break;
              }

              return (
                <div key={activity.id} className="flex items-start space-x-4">
                  <div className={`p-2 rounded-full ${iconBg} mt-0.5`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {activity.agentName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {description} <span className="font-medium text-foreground">{activity.candidateName}</span>
                    </p>
                    <div className="flex items-center pt-1 text-xs text-muted-foreground">
                      <Clock className="mr-1 h-3 w-3" />
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
