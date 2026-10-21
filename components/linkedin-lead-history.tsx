'use client';

import { useState } from 'react';
import { getLinkedinLeadHistoryAction } from '@/app/actions/linkedin/lead-history';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/utils';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function eventDetails(payload: string) {
  try { return JSON.parse(payload) as { changes?:Record<string,{from:unknown;to:unknown}>;source?:string;explanation?:string }; }
  catch { return {}; }
}

export function LinkedinLeadHistory({ leadId }: { leadId:string }) {
  const [open,setOpen] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [data,setData] = useState<Awaited<ReturnType<typeof getLinkedinLeadHistoryAction>> | null>(null);
  const load = async (more = false) => {
    setLoading(true);setError('');
    try {
      const result = await getLinkedinLeadHistoryAction({ leadId,before:more ? data?.next || undefined : undefined });
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
        <p className="text-sm text-muted-foreground">Earlier records show the history available at import. Future CRM changes are recorded as separate events.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {data?.rows.map(row => <details key={row.$id} className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm"><strong>{row.eventType.replaceAll('_',' ')}</strong><br/>{new Date(row.occurredAt).toLocaleString('en-US',{ timeZone:'America/New_York' })} ET · {row.actorName}</summary>
          <div className="mt-3 space-y-2 text-sm">
            {eventDetails(row.payload).explanation && <p>{eventDetails(row.payload).explanation}</p>}
            {Object.entries(eventDetails(row.payload).changes || {}).map(([field,change]) => <div key={field} className="rounded border p-2 break-words">
              <div className="font-medium">{field.replace(/^data\./,'').replace(/([a-z])([A-Z])/g,'$1 $2')}</div>
              <div className="text-muted-foreground">{displayValue(change.from)} → {displayValue(change.to)}</div>
            </div>)}
          </div>
        </details>)}
        {!loading && !error && !data?.rows.length && <p className="text-sm">No stored events yet.</p>}
        {loading && <p className="text-sm">Loading history…</p>}
        {data?.next && <Button variant="outline" disabled={loading} onClick={() => void load(true)}>Load older events</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
