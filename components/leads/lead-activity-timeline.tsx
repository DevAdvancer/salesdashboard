'use client';

import { Activity } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAuditLogs } from '@/lib/services/audit-service';
import type { AuditLog } from '@/lib/types';
import type { Lead } from '@/lib/types';

interface LeadActivityTimelineProps {
  lead: Lead;
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeJsonParse(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function formatChangeValue(key: string, value: unknown) {
  if (value == null) return 'N/A';
  if (typeof value === 'string' && (key.endsWith('At') || key.endsWith('Date'))) {
    return formatDate(value);
  }
  if (typeof value === 'string') return value || 'N/A';
  return String(value);
}

function buildFollowUpDescription(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const changes = metadata.changes;
  if (!isRecord(changes)) return null;

  const order = ['nextFollowUpAt', 'nextAction', 'followUpStatus', 'lastContactedAt'];
  const labels: Record<string, string> = {
    nextFollowUpAt: 'Next Follow-Up',
    nextAction: 'Next Action',
    followUpStatus: 'Follow-Up Status',
    lastContactedAt: 'Last Contacted',
  };

  const parts: string[] = [];
  for (const key of order) {
    const change = changes[key];
    if (!isRecord(change)) continue;
    const from = formatChangeValue(key, change.from);
    const to = formatChangeValue(key, change.to);
    if (from === to) continue;
    parts.push(`${labels[key] ?? key}: ${from} → ${to}`);
  }

  return parts.length > 0 ? parts.join(' • ') : null;
}

export function LeadActivityTimeline({ lead }: LeadActivityTimelineProps) {
  const [followUpLogs, setFollowUpLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { logs } = await getAuditLogs({
          targetType: 'LEAD',
          targetId: lead.$id,
          limit: 50,
          offset: 0,
        });
        if (cancelled) return;

        const followUp = logs.filter((log) => {
          const metadata = safeJsonParse(log.metadata);
          if (isRecord(metadata) && metadata.kind === 'FOLLOW_UP') return true;
          if (!isRecord(metadata)) return false;
          const changes = metadata.changes;
          if (!isRecord(changes)) return false;
          return (
            'nextFollowUpAt' in changes ||
            'nextAction' in changes ||
            'followUpStatus' in changes ||
            'lastContactedAt' in changes
          );
        });

        setFollowUpLogs(followUp.slice(0, 5));
      } catch {
        if (!cancelled) setFollowUpLogs([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lead.$id, lead.$updatedAt]);

  const events = useMemo(() => {
    return [
      { label: 'Created', value: lead.$createdAt },
      { label: 'Last Updated', value: lead.$updatedAt },
      { label: 'Last Contacted', value: lead.lastContactedAt },
      { label: 'Next Follow-Up', value: lead.nextFollowUpAt },
      ...(lead.closedAt ? [{ label: 'Closed', value: lead.closedAt }] : []),
    ].filter((event) => event.value);
  }, [lead.$createdAt, lead.$updatedAt, lead.closedAt, lead.lastContactedAt, lead.nextFollowUpAt]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 && followUpLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline activity yet.</p>
        ) : (
          <div className="space-y-4">
            {followUpLogs.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold">Follow-Up Updates</p>
                {followUpLogs.map((log) => {
                  const metadata = safeJsonParse(log.metadata);
                  const description = buildFollowUpDescription(metadata);
                  return (
                    <div key={log.$id} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Updated by {log.actorName}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(log.performedAt)}</p>
                        {description ? (
                          <p className="text-xs text-muted-foreground break-words">{description}</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {followUpLogs.length > 0 && events.length > 0 ? (
              <div className="h-px w-full bg-border" />
            ) : null}

            {events.length > 0 ? (
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
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
