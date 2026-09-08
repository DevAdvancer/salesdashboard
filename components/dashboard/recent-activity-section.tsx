import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadStatusBadge } from '@/components/ui/lead-status-badge';
import type { Lead } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';
import Link from 'next/link';

import { getLeadName } from '@/lib/utils/dashboard-insights';

interface RecentActivitySectionProps {
  recentLeads: Lead[] | undefined;
  isLoading: boolean;
  className?: string;
}

export function RecentActivitySection({ recentLeads, isLoading, className }: RecentActivitySectionProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-muted-foreground" />
            Recent Activity
          </CardTitle>
          <CardDescription>Recently updated leads.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!recentLeads || recentLeads.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-muted-foreground" />
            Recent Activity
          </CardTitle>
          <CardDescription>Recently updated leads.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recent activity found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-muted-foreground" />
          Recent Activity
        </CardTitle>
        <CardDescription>Recently updated leads.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentLeads.map((lead) => {
            const name = getLeadName(lead);

            return (
              <Link key={lead.$id} href={`/leads/${lead.$id}`} className="block group">
                <div className="flex items-center justify-between gap-4 p-2 -mx-2 rounded-md hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {name}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      Updated {formatDistanceToNow(new Date(lead.$updatedAt || lead.$createdAt || Date.now()), { addSuffix: true })}
                    </span>
                  </div>
                  <LeadStatusBadge status={lead.status} className="text-xs shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
