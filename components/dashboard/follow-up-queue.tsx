'use client';

import { CalendarClock } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { FollowUpQueue } from '@/lib/utils/dashboard-insights';

interface FollowUpQueueCardProps {
  queue: FollowUpQueue | null;
  isLoading: boolean;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'No date';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function QueueList({
  title,
  items,
}: {
  title: string;
  items: NonNullable<FollowUpQueueCardProps['queue']>['overdue'];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nothing here right now.
        </p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((item) => (
            <div key={`${title}-${item.leadId}`} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{item.leadName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.nextAction} - {item.assignedToName}
                  </p>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {formatDateTime(item.nextFollowUpAt)}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.status} / {item.branchName}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, columnIndex) => (
        <div key={columnIndex} className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-6" />
          </div>
          {Array.from({ length: 3 }).map((__, rowIndex) => (
            <div key={rowIndex} className="rounded-md border border-border p-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className="mt-3 h-3 w-28" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FollowUpQueueCard({ queue, isLoading }: FollowUpQueueCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          Follow-Up Tracking
        </CardTitle>
        <CardDescription>Overdue, due today, and upcoming lead actions.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <FollowUpSkeleton />
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            <QueueList title="Overdue" items={queue?.overdue ?? []} />
            <QueueList title="Due Today" items={queue?.dueToday ?? []} />
            <QueueList title="Upcoming" items={queue?.upcoming ?? []} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
