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
/** Start (with a target) or stop impersonating, then reload every tab as the new identity. */
async function switchUser(target: string | null) {
  const response = await fetch('/api/security/impersonation', { method: target === null ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json' }, ...(target === null ? {} : { body: JSON.stringify({ target }) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not switch users.');
  // Complete the identity switch even if local persistence is unavailable.
  await clearIdentityData().catch(() => {});
  try { localStorage.setItem(identityChangeKey, crypto.randomUUID()); } catch { /* Restricted storage. */ }
  window.location.assign(data.redirect);
}

/** Users page only: shown just to accounts Appwrite grants impersonation capability. */
export function ImpersonationStart() {
  const { user } = useAuth();
  const [canImpersonate, setCanImpersonate] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const impersonating = Boolean(user?.impersonatorUserId);
  useEffect(() => {
    // While impersonating, the top banner is the only control.
    if (impersonating) return;
    const controller = new AbortController();
    void fetch('/api/security/impersonation', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.ok) setCanImpersonate(Boolean((await response.json() as Status).canImpersonate));
    }).catch(() => { /* A native permission check is required before showing controls. */ });
    return () => controller.abort();
  }, [impersonating]);
  if (impersonating || !canImpersonate) return null;
  const start = async () => {
    setBusy(true); setError('');
    try { await switchUser(target); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not switch users.'); setBusy(false); }
  };
  return <aside className="mb-5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" aria-label="User impersonation">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void start(); }}>
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor="impersonation-target">Impersonate a user</Label>
        <Input id="impersonation-target" placeholder="CRM user email or Appwrite user ID" value={target} onChange={event => setTarget(event.target.value)} disabled={busy} required maxLength={320} />
      </div><Button disabled={busy || !target.trim()} type="submit">{busy ? 'Switching…' : 'Start impersonating'}</Button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </aside>;
}

/**
 * Every page: a floating banner only while impersonating, from the signed-in
 * profile (no extra request). Also reloads this tab when another tab switches identity.
 */
export function ImpersonationBanner() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === identityChangeKey) void clearIdentityData().catch(() => {}).finally(() => window.location.assign(new URL('/login', window.location.origin).href));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  if (!user?.impersonatorUserId) return null;
  const stop = async () => {
    setBusy(true); setError('');
    try { await switchUser(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not switch users.'); setBusy(false); }
  };
  return <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
    <aside className="pointer-events-auto w-full max-w-2xl rounded-xl border border-amber-500/60 bg-background/95 p-3 shadow-lg backdrop-blur" aria-label="User impersonation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm"><strong>{user.impersonatorName || 'Operator'}</strong> is impersonating <strong>{user.name}</strong>. Access follows this user.</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void stop()}>{busy ? 'Stopping…' : 'Stop impersonating'}</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </aside>
  </div>;
}
