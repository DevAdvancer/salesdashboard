'use client';

import { LinkedinLeadHistory } from '@/components/linkedin-lead-history';
import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Lead } from '@/lib/types';
import { formatEasternDateTime } from '@/lib/utils/eastern-date';

interface LeadActivityTimelineProps {
  lead: Lead;
}

function formatDate(isoString: string | null | undefined): string {
  return isoString ? formatEasternDateTime(isoString) : 'N/A';
}

export function LeadActivityTimeline({ lead }: LeadActivityTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity Timeline
          </CardTitle>
          <LinkedinLeadHistory leadId={lead.$id} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="font-medium">Created</dt>
            <dd className="text-muted-foreground">{formatDate(lead.$createdAt)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium">Last Updated</dt>
            <dd className="text-muted-foreground">{formatDate(lead.$updatedAt)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
