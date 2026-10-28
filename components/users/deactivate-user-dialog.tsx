'use client';

import { useEffect, useState } from 'react';
import { previewUserDeactivationAction, setAgentActiveAction } from '@/app/actions/user';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { User } from '@/lib/types';

type Preview = Awaited<ReturnType<typeof previewUserDeactivationAction>>;

export function DeactivateUserDialog({ target, actorId, onClose, onComplete }: {
  target: User | null; actorId: string; onClose: () => void; onComplete: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => { setRecipientId(''); setPreview(null); setError(''); setProgress(''); }, [target?.$id]);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true); setPreview(null);
    previewUserDeactivationAction({ userId: target.$id, currentUserId: actorId, recipientId: recipientId || undefined })
      .then(result => { if (!cancelled) { setPreview(result); setError(''); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to preview handoff.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, actorId, recipientId, revision]);

  const submit = async () => {
    if (!target || !preview) return;
    setSaving(true); setError(''); setProgress('');
    try {
      let current = preview;
      let transferred = 0;
      let remaining = 0;
      do {
        const result = await setAgentActiveAction({ userId: target.$id, currentUserId: actorId, isActive: false,
          recipientId: current.recipientId || undefined, planHash: current.hash });
        transferred += result.leadsTransferred || 0;
        remaining = result.remainingLeads || 0;
        setProgress(`${transferred} leads handed over${remaining ? ` · ${remaining} remaining` : ''}.`);
        if (remaining) {
          if (!result.leadsTransferred) throw new Error('No leads could be transferred. Refresh the preview to retry.');
          current = await previewUserDeactivationAction({ userId: target.$id, currentUserId: actorId,
            recipientId: preview.recipientId || undefined });
        }
      } while (remaining > 0);
      await onComplete(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete handoff.');
      setPreview(null);
      await onComplete();
    } finally { setSaving(false); }
  };

  return <Dialog open={Boolean(target)} onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{target?.isActive === false ? 'Complete handoff' : 'Inactivate user'}: {target?.name}</DialogTitle>
        <DialogDescription>Choose who will receive their leads. You can choose yourself. Review the totals before confirming.</DialogDescription>
      </DialogHeader>
      {preview && <div className="space-y-4">
        {preview.recipients.length > 0 && <div className="space-y-2">
          <Label htmlFor="handoff-recipient">Hand all leads to</Label>
          <select id="handoff-recipient" className="w-full rounded-md border bg-background p-2 text-sm"
            value={preview.recipientId} disabled={saving || loading} onChange={event => setRecipientId(event.target.value)}>
            {preview.recipients.map(recipient => <option key={recipient.$id} value={recipient.$id}>
              {recipient.name}{recipient.$id === actorId ? ' (myself)' : ''} · {recipient.role.replaceAll('_', ' ')}
            </option>)}
          </select>
        </div>}
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{preview.openLeads} open leads and {preview.closedLeads} closed leads: owner and assigned user will both change.</li>
          <li>{preview.requests} active LinkedIn requests will be marked withdrawn in CRM across {preview.accounts} assigned accounts.</li>
          <li>Assigned LinkedIn accounts and this user&apos;s login will be disabled.</li>
        </ul>
        <p className="text-sm text-muted-foreground">Original creator, past history, lead status and payments are preserved. The handoff appears in Lead History for open and closed leads.</p>
      </div>}
      {loading && <p className="text-sm">Loading current handoff totals…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {!preview && !loading && <Button variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh preview</Button>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button disabled={!preview || loading || saving} onClick={() => void submit()}>
          {saving ? 'Completing handoff…' : 'Confirm handoff and inactivate'}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
