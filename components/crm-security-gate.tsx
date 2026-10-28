'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { VerifiedLoginRedirect } from '@/components/verified-login-redirect';
import { crmHomePath } from '@/lib/utils/crm-home-path';
import { replaceDocument } from '@/lib/utils/document-navigation';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CrmAccessStatus } from '@/lib/server/crm-access';
import { withClientTimeout } from '@/lib/utils/client-timeout';

async function postAccess(body: Record<string, unknown>) {
  return withClientTimeout(async signal => {
    const response = await fetch('/api/security/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Access verification failed.');
    return data;
  }, 30_000, 'Access verification took too long. Please retry.');
}

export function CrmSecurityGate({ children }: { children: React.ReactNode }) {
  const { user, loading, serverSessionReady, initialAccess, activeDashboard, logout, recoverServerSession,
    sessionRestoreError, retrySessionRestore } = useAuth();
  const pathname = usePathname();
  const [result, setResult] = useState<{ userId: string; status: CrmAccessStatus | null } | null>(null);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ challengeId: string; purpose: 'login' | 'delegate' } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const autoSentFor = useRef<string | null>(null);
  const generation = useRef(0);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const lastCheckedAt = useRef(0);
  const bootstrap = useRef(initialAccess);
  useEffect(() => { bootstrap.current = initialAccess; }, [initialAccess]);
  const userId = user?.$id;
  // A fresh server bootstrap is usable in this render; waiting for an effect
  // previously flashed the security panel on every hard refresh.
  const status = !serverSessionReady || !userId ? null : result?.userId === userId ? result.status
    : initialAccess?.userId === userId ? initialAccess?.status : null;
  const publicPage = pathname === '/referral' || pathname === '/maintenance';
  // Read by the interval below without re-creating it on every status change.
  const allowedRef = useRef(false);
  const allowed = status?.state === 'allowed' || status?.state === 'disabled';
  useEffect(() => { allowedRef.current = allowed; }, [allowed]);

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
      lastCheckedAt.current = Date.now();
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
    autoSentFor.current = null;
    setSessionExpired(false);
    setChallenge(null); setCode(''); setName('');
  }, [userId]);

  useEffect(() => {
    const effectGeneration = ++generation.current;
    // Profile object refreshes and bootstrap updates must not clear an already
    // verified status or unmount every CRM data provider.
    if (!userId || !serverSessionReady) setResult(null);
    else if (bootstrap.current?.userId === userId) {
      const initial = bootstrap.current;
      setResult(current => current?.userId === userId ? current : initial);
      lastCheckedAt.current = Date.now();
    }
    else void refresh();
    const focused = () => { if (!allowedRef.current && Date.now() - lastCheckedAt.current >= 30_000) void refresh(); };
    const forced = () => void refresh();
    window.addEventListener('focus', focused);
    window.addEventListener('crm-access-recheck', forced);
    // This local clock makes no requests for an allowed user. Their only scheduled
    // attendance review is recheckAt (10 AM weekdays); real requests still authorize
    // fresh. Waiting users poll for cover approval, and blocked reads force recheck.
    const interval = window.setInterval(() => {
      setClock(Date.now());
      if (document.visibilityState === 'visible' && !allowedRef.current) void refresh();
    }, 60_000);
    return () => { generation.current = effectGeneration + 1; pendingRefresh.current = null; window.removeEventListener('focus', focused); window.removeEventListener('crm-access-recheck', forced); window.clearInterval(interval); };
  }, [refresh, userId, serverSessionReady]);

  useEffect(() => {
    if (!status?.recheckAt) return;
    const delay = Date.parse(status.recheckAt) - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => void refresh(), Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [status?.recheckAt, refresh]);

  const sendLoginCode = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const data = await postAccess({ operation: 'send-login-code' });
      setChallenge({ challengeId: data.challengeId, purpose: 'login' }); setCode('');
      setSentAt(Date.now()); setClock(Date.now());
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send the code.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (status?.state !== 'otp_required' || !user || autoSentFor.current === user.$id) return;
    autoSentFor.current = user.$id;
    void sendLoginCode();
  }, [status?.state, user, sendLoginCode]);

  if (publicPage) return <>{children}</>;
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

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true); setError('');
    try {
      const verified = await postAccess({ operation: challenge.purpose === 'login' ? 'verify-login' : 'request-cover', challengeId: challenge.challengeId, code });
      setChallenge(null); setCode('');
      if (verified.status) setResult({ userId: user.$id, status: verified.status });
      else await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Verification failed.'); }
    finally { setBusy(false); }
  };
  const verifyName = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await postAccess({ operation: 'send-delegate-code', name });
      setChallenge({ challengeId: data.challengeId, purpose: 'delegate' }); setCode('');
      setSentAt(Date.now()); setClock(Date.now());
    } catch (err) { setError(err instanceof Error ? err.message : 'Name verification failed.'); }
    finally { setBusy(false); }
  };
  const otpRequired = status?.state === 'otp_required';
  return <main className="min-h-screen flex items-center justify-center bg-background p-6">
    <section className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-7 shadow-lg" aria-labelledby="crm-access-title">
      <ShieldCheck className="h-8 w-8 text-primary" aria-hidden />
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">CRM HUB · Secure access</p>
        <h1 id="crm-access-title" className="text-2xl font-semibold">{!status ? sessionExpired ? 'Please sign in again' : error ? 'Could not confirm access' : 'Checking your access' : otpRequired ? 'Verify your email' : 'Attendance approval required'}</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>
      {otpRequired && <p className="text-sm">Enter the six-digit code sent to your sign-in email. The code expires in 10 minutes.</p>}
      {status?.state === 'attendance_required' && <>
        <p className="text-sm">You are not marked present for {status.dateKey} (Eastern time). Ask your TL or manager to mark you present, or assign someone to cover you if you are absent.</p>
        {status.canVerifyDelegate && !challenge && <form onSubmit={verifyName} className="space-y-3">
          <Label htmlFor="cover-name">Assigned person&apos;s full name</Label>
          <Input id="cover-name" value={name} onChange={event => setName(event.target.value)} maxLength={255} required disabled={busy} />
          <p className="text-xs text-muted-foreground">Only the person already assigned in CRM can request cover access. A verification code will go to their own email, then your TL or manager must approve access.</p>
          <Button type="submit" disabled={busy || !name.trim()}>Verify assigned person</Button>
        </form>}
      </>}
      {status?.state === 'approval_pending' && <p className="text-sm">Your assigned cover is verified. Ask your TL or manager to approve the request in Attendance → CRM access approvals. Access stays blocked until approval.</p>}
      {status?.state === 'approval_denied' && <p className="text-sm">Your cover request was declined or revoked. Please contact your TL or manager.</p>}
      {challenge && <form onSubmit={verifyCode} className="space-y-3">
        <Label htmlFor="access-code">{challenge.purpose === 'delegate' ? 'Code sent to the assigned person’s email' : 'Email verification code'}</Label>
        <Input id="access-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6}
          value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required disabled={busy} />
        <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : challenge.purpose === 'delegate' ? 'Verify and request approval' : 'Verify and continue'}</Button>
      </form>}
      {otpRequired && <Button variant="outline" disabled={busy || clock - sentAt < 60_000} onClick={() => void sendLoginCode()}>
        {challenge ? 'Resend code' : 'Send verification code'}
      </Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3 border-t pt-4">
        {sessionExpired && <Button onClick={() => void logout().then(() => replaceDocument('/login'))}>Sign in again</Button>}
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Check access again</Button>
        <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
      </div>
    </section>
  </main>;
}
