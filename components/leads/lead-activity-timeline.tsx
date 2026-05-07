'use client';

import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Lead } from '@/lib/types';

interface LeadActivityTimelineProps {
  lead: Lead;
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}

export function LeadActivityTimeline({ lead }: LeadActivityTimelineProps) {
  const events = [
    { label: 'Created', value: lead.$createdAt },
    { label: 'Last Updated', value: lead.$updatedAt },
    { label: 'Last Contacted', value: lead.lastContactedAt },
    { label: 'Next Follow-Up', value: lead.nextFollowUpAt },
    ...(lead.closedAt ? [{ label: 'Closed', value: lead.closedAt }] : []),
  ].filter((event) => event.value);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline activity yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.label} className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                <div>
                  <p className="text-sm font-medium">{event.label}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(event.value)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
