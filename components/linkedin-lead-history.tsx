'use client';

import { useState } from 'react';
import { getLinkedinLeadHistoryAction } from '@/app/actions/linkedin/lead-history';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/utils';
import { readableLeadHistory, visibleLeadHistoryEvent } from '@/lib/utils/lead-history-display';
import { getUsersNamesAction } from '@/app/actions/user';

function eventDetails(payload: string) {
  try { return JSON.parse(payload) as { changes?:Record<string,{from:unknown;to:unknown}>;source?:string;explanation?:string }; }
  catch { return {}; }
}

export function LinkedinLeadHistory({ leadId }: { leadId:string }) {
  const [open,setOpen] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [data,setData] = useState<Awaited<ReturnType<typeof getLinkedinLeadHistoryAction>> | null>(null);
  const load = async (more = false) => {
    setLoading(true);setError('');
    try {
      const result = await getLinkedinLeadHistoryAction({ leadId,before:more ? data?.next || undefined : undefined });
      const ids = result.rows.flatMap(row => Object.entries(eventDetails(row.payload).changes || {})
        .filter(([field]) => ['ownerId', 'assignedToId', 'agentId', 'data.creatorId'].includes(field))
        .flatMap(([, change]) => [change.from, change.to]).filter((id): id is string => typeof id === 'string' && Boolean(id)));
      const resolved = ids.length ? await getUsersNamesAction([...new Set(ids)]) : {};
      setNames(previous => ({ ...previous, ...resolved }));
      setData(previous => ({ ...result,rows:more ? [...previous?.rows || [],...result.rows] : result.rows }));
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  };
  return <>
    <Button variant="outline" onClick={() => { setOpen(true);void load(); }}>Lead History</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lead History</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground break-all">Lead {leadId}</p>
        <p className="text-sm text-muted-foreground">Creation, handoffs and changes stay with this lead, whether it is open or closed. Earlier imported records may have limited history.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {data?.rows.filter(row => visibleLeadHistoryEvent(row.eventType)).map(row => <details key={row.$id} className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm"><strong>{readableLeadHistory(row.eventType, eventDetails(row.payload).changes || {}, names).title}</strong><br/>{new Date(row.occurredAt).toLocaleString('en-US',{ timeZone:'America/New_York' })} ET · {row.actorName}</summary>
          <div className="mt-3 space-y-2 text-sm">
            {eventDetails(row.payload).explanation && <p>{eventDetails(row.payload).explanation}</p>}
            {readableLeadHistory(row.eventType, eventDetails(row.payload).changes || {}, names).details.map((detail, index) => <p key={index} className="break-words text-muted-foreground">{detail}</p>)}
          </div>
        </details>)}
        {!loading && !error && !data?.rows.some(row => visibleLeadHistoryEvent(row.eventType)) && <p className="text-sm">No completed changes recorded on this page.</p>}
        {loading && <p className="text-sm">Loading history…</p>}
        {data?.next && <Button variant="outline" disabled={loading} onClick={() => void load(true)}>Load older events</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
