'use client';

import { useEffect, useState } from 'react';
import { del } from 'idb-keyval';
import { getQueryClient, clearBrowserQueryClient } from '@/lib/queries/client';
import { databases } from '@/lib/appwrite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/contexts/auth-context';

type Status = { canImpersonate: boolean; operator: { id: string; name: string }; active: { id: string; name: string } | null };
const identityChangeKey = 'crm.identity-change';
async function clearIdentityData() {
  await getQueryClient().cancelQueries();
  clearBrowserQueryClient();
  databases.clearReadCache?.();
  await del('REACT_QUERY_OFFLINE_CACHE');
}

export function ImpersonationControl() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/security/impersonation', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.ok) setStatus(await response.json());
      else if (user?.impersonatorUserId) setError('Impersonation permission changed. Stop impersonating to return to your account.');
      else if (response.status !== 401 && response.status !== 403) setError('User switching is temporarily unavailable.');
    }).catch(() => { /* A native permission check is required before showing controls. */ });
    const changed = (event: StorageEvent) => {
      if (event.key === identityChangeKey) void clearIdentityData().catch(() => {}).finally(() => window.location.assign(new URL('/login', window.location.origin).href));
    };
    window.addEventListener('storage', changed);
    return () => { controller.abort(); window.removeEventListener('storage', changed); };
  }, [user?.impersonatorUserId]);
  async function switchUser(stop: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/security/impersonation', { method: stop ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' }, ...(stop ? {} : { body: JSON.stringify({ target }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not switch users.');
      // Complete the identity switch even if local persistence is unavailable.
      await clearIdentityData().catch(() => {});
      try { localStorage.setItem(identityChangeKey, crypto.randomUUID()); } catch { /* Restricted storage. */ }
      window.location.assign(data.redirect);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not switch users.'); setBusy(false); }
  }
  const active = status?.active || (user?.impersonatorUserId ? { id: user.$id, name: user.name } : null);
  if (!status?.canImpersonate && !active && !error) return null;
  return <aside className="mb-5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" aria-label="User impersonation">
    {active ? <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status"><strong>{status?.operator.name || user?.impersonatorName || 'Operator'}</strong> is impersonating <strong>{active.name}</strong>. Access follows this user.</p>
      <Button variant="outline" disabled={busy} onClick={() => void switchUser(true)}>Stop impersonating</Button>
    </div> : status?.canImpersonate ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void switchUser(false); }}>
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor="impersonation-target">Impersonate a user</Label>
        <Input id="impersonation-target" placeholder="CRM user email or Appwrite user ID" value={target} onChange={event => setTarget(event.target.value)} disabled={busy} required maxLength={320} />
      </div><Button disabled={busy || !target.trim()} type="submit">{busy ? 'Switching…' : 'Start impersonating'}</Button>
    </form> : null}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </aside>;
}
