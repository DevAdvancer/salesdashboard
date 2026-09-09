import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadStatusBadge } from '@/components/ui/lead-status-badge';
import type { StatusBreakdownItem } from '@/lib/utils/dashboard-insights';

interface StatusBreakdownSectionProps {
  breakdown: StatusBreakdownItem[] | undefined;
  isLoading: boolean;
  className?: string;
}

export function StatusBreakdownSection({ breakdown, isLoading, className }: StatusBreakdownSectionProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Pipeline by Status</CardTitle>
          <CardDescription>Breakdown of all active and closed leads.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!breakdown || breakdown.length === 0) {
    return null; // hide if no data
  }

  const maxCount = Math.max(...breakdown.map(b => b.count));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Pipeline by Status</CardTitle>
        <CardDescription>Breakdown of all active and closed leads.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {breakdown.map((item) => (
            <div key={item.status} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <LeadStatusBadge status={item.status} className="text-xs" />
                <span className="text-sm font-medium">{item.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div 
                  className="h-full bg-gradient-to-r from-[var(--info)] to-[var(--info-deep)] transition-all duration-500 ease-in-out" 
                  style={{ width: `${(item.count / maxCount) * 100}%` }} 
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

