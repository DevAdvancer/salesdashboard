'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { VerifiedLoginRedirect } from '@/components/verified-login-redirect';
import { crmHomePath } from '@/lib/utils/crm-home-path';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CrmAccessStatus } from '@/lib/server/crm-access';

async function postAccess(body: Record<string, unknown>) {
  const response = await fetch('/api/security/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Access verification failed.');
  return data;
}

export function CrmSecurityGate({ children }: { children: React.ReactNode }) {
  const { user, loading, serverSessionReady, initialAccess, activeDashboard, logout } = useAuth();
  const pathname = usePathname();
  const [result, setResult] = useState<{ userId: string; status: CrmAccessStatus } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ challengeId: string; purpose: 'login' | 'delegate' } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const autoSentFor = useRef<string | null>(null);
  const generation = useRef(0);
  const status = result?.userId === user?.$id ? result?.status : null;
  const publicPage = pathname === '/referral' || pathname === '/maintenance';

  const refresh = useCallback(async () => {
    if (!user || !serverSessionReady || publicPage) return;
    const requestGeneration = generation.current;
    try {
      const response = await fetch('/api/security/access', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check CRM access.');
      if (requestGeneration !== generation.current) return;
      setResult({ userId: user.$id, status: data });
      setError('');
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : 'Could not check CRM access.');
    }
  }, [user, serverSessionReady, publicPage]);

  useEffect(() => {
    const effectGeneration = ++generation.current;
    autoSentFor.current = null;
    setChallenge(null); setCode(''); setName(''); setResult(null);
    if (initialAccess?.userId === user?.$id) setResult(initialAccess || null);
    else void refresh();
    const focused = () => void refresh();
    window.addEventListener('focus', focused);
    window.addEventListener('crm-access-recheck', focused);
    const interval = window.setInterval(() => {
      setClock(Date.now());
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => { generation.current = effectGeneration + 1; window.removeEventListener('focus', focused); window.removeEventListener('crm-access-recheck', focused); window.clearInterval(interval); };
  }, [refresh, initialAccess, user?.$id]);

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
  if (loading) return <main className="min-h-screen flex items-center justify-center" role="status">Checking your session…</main>;
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
        <h1 id="crm-access-title" className="text-2xl font-semibold">{!status ? 'Checking your access' : otpRequired ? 'Verify your email' : 'Attendance approval required'}</h1>
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
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Check access again</Button>
        <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
      </div>
    </section>
  </main>;
}
