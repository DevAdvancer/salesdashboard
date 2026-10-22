'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { formatEasternDateTime } from '@/lib/utils/eastern-date';

type Approval = { id: string; userName: string; delegateName: string; state: string; requestedAt: string; decidedByName?: string };
export function AttendanceAccessApprovals() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Approval[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canReview = user && ['admin', 'developer', 'operations', 'team_lead', 'senior_tl'].includes(user.role);
  const refresh = useCallback(async () => {
    if (!canReview) return;
    try {
      const response = await fetch('/api/security/access?view=approvals', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load access requests.');
      setRequests(data.state === 'disabled' ? null : data.requests); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load access requests.'); }
  }, [canReview]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  if (!canReview || (!requests && !error)) return null;
  const decide = async (requestId: string, approve: boolean) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/security/access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'decide', requestId, approve }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the decision.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the decision.'); }
    finally { setBusy(false); }
  };
  return <Card>
    <CardHeader><CardTitle>CRM access approvals</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Approve verified assigned cover for today only. This grants CRM access without changing the absent person&apos;s attendance.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!error && requests?.length === 0 && <p className="text-sm text-muted-foreground">No access requests for your team today.</p>}
      {requests?.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="text-sm"><p><strong>{request.delegateName}</strong> covering {request.userName}</p>
          <p className="text-xs text-muted-foreground">{formatEasternDateTime(request.requestedAt)} · {request.state}{request.decidedByName ? ` · ${request.decidedByName}` : ''}</p></div>
        <div className="flex gap-2">
          {request.state === 'pending' && <Button disabled={busy} onClick={() => void decide(request.id, true)}>Approve today</Button>}
          {request.state !== 'denied' && <Button variant="outline" disabled={busy} onClick={() => void decide(request.id, false)}>{request.state === 'approved' ? 'Revoke' : 'Decline'}</Button>}
        </div>
      </div>)}
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh requests</Button>
    </CardContent>
  </Card>;
}
