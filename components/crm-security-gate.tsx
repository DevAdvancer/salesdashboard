'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { VerifiedLoginRedirect } from '@/components/verified-login-redirect';
import { crmHomePath } from '@/lib/utils/crm-home-path';
import { replaceDocument } from '@/lib/utils/document-navigation';
import { NativeMfaGate } from '@/components/native-mfa-gate';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import type { CrmAccessStatus } from '@/lib/server/crm-access';
import { withClientTimeout } from '@/lib/utils/client-timeout';

export function CrmSecurityGate({ children }: { children: React.ReactNode }) {
  const { user, loading, serverSessionReady, initialAccess, activeDashboard, logout, recoverServerSession,
    sessionRestoreError, retrySessionRestore, nativeMfaPending } = useAuth();
  const pathname = usePathname();
  const [result, setResult] = useState<{ userId: string; status: CrmAccessStatus | null } | null>(null);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const generation = useRef(0);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const bootstrap = useRef(initialAccess);
  useEffect(() => { bootstrap.current = initialAccess; }, [initialAccess]);
  const userId = user?.$id;
  // A fresh server bootstrap is usable in this render; waiting for an effect
  // previously flashed the security panel on every hard refresh.
  const status = !serverSessionReady || !userId ? null : result?.userId === userId ? result.status
    : initialAccess?.userId === userId ? initialAccess?.status : null;
  const publicPage = pathname === '/referral';
  const refresh = useCallback(async () => {
    if (loading || sessionRestoreError || !userId || !serverSessionReady || publicPage) return;
    if (pendingRefresh.current) return pendingRefresh.current;
    const requestGeneration = generation.current;
    const request = (async () => {
    try {
      // A single temporary network failure should not dismantle the dashboard.
      // Recheck once, without showing an intermediate checking screen.
      const read = () => withClientTimeout(async signal => {
        const response = await fetch('/api/security/access', { cache: 'no-store', signal });
        return { response, data: await response.json() };
      }, 10_000, 'Access verification took too long. Please retry.');
      let checked = await read().catch(() => null);
      if (requestGeneration !== generation.current) return;
      if (!checked || checked.response.status >= 500) checked = await read();
      if (requestGeneration !== generation.current) return;
      let response = checked?.response;
      if (response?.status === 401 && recoverServerSession) {
        await withClientTimeout(() => recoverServerSession(), 12_000, 'Session restoration took too long. Please retry.');
        checked = await read();
        response = checked.response;
      }
      if (!response || !checked) throw new Error('Could not check CRM access.');
      const data = checked.data;
      if (requestGeneration !== generation.current) return;
      setSessionExpired(response.status === 401);
      if (!response.ok) throw new Error(data.error || 'Could not check CRM access.');
      if (requestGeneration !== generation.current) return;
      setResult({ userId, status: data });
      setError('');
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      if ((err as { code?: number })?.code === 401) setSessionExpired(true);
      // Keep a failed check explicit; an older bootstrap must never re-allow access.
      setResult({ userId, status: null });
      setError(err instanceof Error ? err.message : 'Could not check CRM access.');
    }
    })();
    pendingRefresh.current = request;
    try { await request; } finally { if (pendingRefresh.current === request) pendingRefresh.current = null; }
  }, [userId, loading, sessionRestoreError, serverSessionReady, publicPage, recoverServerSession]);

  useEffect(() => {
    const effectGeneration = ++generation.current;
    // Profile object refreshes and bootstrap updates must not clear an already
    // verified status or unmount every CRM data provider.
    if (!userId || !serverSessionReady) setResult(null);
    else if (bootstrap.current?.userId === userId) {
      const initial = bootstrap.current;
      setResult(current => current?.userId === userId ? current : initial);
    }
    else void refresh();
    const forced = () => void refresh();
    window.addEventListener('crm-access-recheck', forced);
    return () => { generation.current = effectGeneration + 1; pendingRefresh.current = null; window.removeEventListener('crm-access-recheck', forced); };
  }, [refresh, userId, serverSessionReady]);

  useEffect(() => {
    if (!status?.recheckAt) return;
    const delay = Date.parse(status.recheckAt) - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => void refresh(), Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [status?.recheckAt, refresh]);

  if (publicPage) return <>{children}</>;
  const nativeVerification = () => { retrySessionRestore?.(); };
  if (!loading && nativeMfaPending) return <NativeMfaGate onVerified={nativeVerification} onSignOut={logout} />;
  if (!loading && (status?.state === 'mfa_required' || status?.state === 'mfa_setup_required')) {
    return <NativeMfaGate onVerified={nativeVerification} onSignOut={logout} />;
  }
  if (loading || (!sessionRestoreError && user && (!serverSessionReady || (!status && !error)))) return (
    <main className="min-h-screen bg-background p-6" role="status" aria-label="Loading CRM HUB" aria-busy="true">
      <div className="mx-auto max-w-6xl space-y-6 pt-8">
        <p className="text-sm text-muted-foreground">Loading CRM HUB…</p>
        <div aria-hidden="true" className="space-y-6">
          <div className="h-10 w-48 rounded bg-muted" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map(key => <div key={key} className="h-24 rounded-xl bg-muted" />)}</div>
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    </main>
  );
  if (sessionRestoreError) return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="max-w-md space-y-4 rounded-2xl border bg-card p-7">
        <h1 className="text-xl font-semibold">Could not load your session</h1>
        <p role="alert" className="text-sm text-muted-foreground">{sessionRestoreError}</p>
        <Button onClick={retrySessionRestore}>Retry loading</Button>
      </section>
    </main>
  );
  if (!user) return <>{children}</>;
  if (status?.state === 'allowed' || status?.state === 'disabled') {
    if (pathname === '/login') return <VerifiedLoginRedirect target={crmHomePath(user, activeDashboard)} onSignOut={logout} />;
    return <>{children}</>;
  }

  return <main className="min-h-screen flex items-center justify-center p-6">
    <section className="max-w-md space-y-4 rounded-2xl border bg-card p-7">
      <h1 className="text-xl font-semibold">{sessionExpired ? 'Please sign in again' : 'Could not confirm access'}</h1>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="outline" onClick={() => void refresh()}>Check access again</Button>
      <Button variant="ghost" onClick={() => void logout().then(() => replaceDocument('/login'))}>Sign out</Button>
      {sessionExpired && <Button onClick={() => void logout().then(() => replaceDocument('/login'))}>Sign in again</Button>}
    </section>
  </main>;
}
