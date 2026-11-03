'use client';

import { useEffect, useState } from 'react';
import { setUserPasswordAction } from '@/app/actions/user';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/utils/password-reset-policy';
import type { User } from '@/lib/types';

export function SetPasswordDialog({ target, onClose }: { target: User | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { setPassword(''); setConfirm(''); setError(''); setDone(false); }, [target?.$id]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH && password === confirm;
  const submit = async () => {
    if (!target || !valid) return;
    setSaving(true); setError('');
    try {
      await setUserPasswordAction({ userId: target.$id, password });
      setPassword(''); setConfirm(''); setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally { setSaving(false); }
  };

  return <Dialog open={!!target} onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Set password for {target?.name}</DialogTitle>
        <DialogDescription>
          They will be signed out everywhere and must sign in with the new password and their email code.
        </DialogDescription>
      </DialogHeader>
      {done ? <div className="space-y-4">
        <p role="status">Password changed for {target?.name}. Share it with them securely.</p>
        <Button onClick={onClose}>Done</Button>
      </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="space-y-1">
          <Label htmlFor="set-password-new">New password</Label>
          <Input id="set-password-new" type="password" autoComplete="new-password" value={password} disabled={saving}
            minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required onChange={event => setPassword(event.target.value)} />
          <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="set-password-confirm">Confirm password</Label>
          <Input id="set-password-confirm" type="password" autoComplete="new-password" value={confirm} disabled={saving}
            maxLength={MAX_PASSWORD_LENGTH} required onChange={event => setConfirm(event.target.value)} aria-invalid={mismatch} />
          {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !valid} loading={saving}>Set password</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
