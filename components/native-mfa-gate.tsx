'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthenticationFactor } from 'appwrite';
import { account } from '@/lib/appwrite';
import { withClientTimeout } from '@/lib/utils/client-timeout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = { onVerified: () => void | Promise<void>; onSignOut: () => void | Promise<void> };
const moreFactors = (error: unknown) => (error as { type?: string })?.type === 'user_more_factors_required';
const message = (error: unknown) => {
  const type = (error as { type?: string })?.type || '';
  if (/rate_limit/.test(type) || (error as { code?: number })?.code === 429) return 'Please wait before requesting another code.';
  if (/invalid|expired/.test(type)) return 'The code is incorrect or has expired. Request a new code.';
  return 'Could not complete native verification. Please retry or contact your administrator.';
};

/** All verification/enrolment calls go directly to Appwrite, never a CRM OTP route. */
export function NativeMfaGate({ onVerified, onSignOut }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [emailUnverified, setEmailUnverified] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const generation = useRef(0);
  const run = useCallback(async (task: (check: () => void) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const attempt = ++generation.current;
    setBusy(true); setError('');
    try { await withClientTimeout(signal => task(() => {
      if (signal.aborted || !mounted.current || attempt !== generation.current) throw new Error('Verification attempt ended.');
    }), 20_000, 'Verification timed out. Please retry.'); }
    catch (err) { if (mounted.current) setError(message(err)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, []);

  const sendCode = useCallback(async (check: () => void) => {
    let user;
    try { user = await account.get(); } catch (err) { if (!moreFactors(err)) throw err; }
    check();
    if (user && !user.emailVerification) {
      // Enrol only after native email ownership verification. Never mark an email
      // verified from the admin SDK just to make MFA available.
      const params = new URLSearchParams(window.location.search);
      const userId = params.get('userId'); const secret = params.get('secret');
      if (userId === user.$id && secret && secret.length <= 2048) {
        params.delete('userId'); params.delete('secret');
        window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
        await account.updateEmailVerification({ userId, secret });
        check();
        try { user = await account.get(); }
        catch (err) { if (!moreFactors(err)) throw err; user = undefined; }
        check();
      }
      if (user && !user.emailVerification) { setEmailUnverified(true); return; }
    }
    setEmailUnverified(false);
    if (user && !user.mfa) await account.updateMFA({ mfa: true });
    check();
    const factors = await account.listMFAFactors();
    check();
    if (!factors.email) throw new Error('A verified email factor is required.');
    const next = await account.createMFAChallenge({ factor: AuthenticationFactor.Email });
    check();
    setChallenge(next.$id); setCode(''); setSentAt(Date.now()); setNow(Date.now());
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!started.current) { started.current = true; void run(sendCode); }
    return () => { mounted.current = false; };
  }, [run, sendCode]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const verify = () => run(async check => {
    if (!challenge || !/^\d{6}$/.test(code)) return;
    await account.updateMFAChallenge({ challengeId: challenge, otp: code });
    check();
    // The server re-reads session.factors and mfaUpdatedAt. The SDK result or a
    // browser flag is never enough to mount CRM providers.
    await onVerified();
  });

  return <main className="min-h-screen flex items-center justify-center p-6">
    <section className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-7">
      <h1 className="text-2xl font-semibold">Verify your sign-in</h1>
      {emailUnverified ? <>
        <p>Verify ownership of your registered email once to enable native two-factor authentication.</p>
        <Button disabled={busy || (verificationSent && now - sentAt < 60_000)} onClick={() => void run(async check => {
          await account.createEmailVerification({ url: `${window.location.origin}/login` });
          check();
          setVerificationSent(true); setSentAt(Date.now()); setNow(Date.now());
        })}>Send email verification link</Button>
        {verificationSent && <p role="status">Open the link in your email, then continue here. If it opens another device, sign in there first.</p>}
        <Button variant="outline" disabled={busy} onClick={() => void run(sendCode)}>I verified my email</Button>
      </> : <>
        <p>Enter the six-digit code sent by Appwrite to your registered email. You only need a code once per sign-in.</p>
        <form onSubmit={event => { event.preventDefault(); void verify(); }} className="space-y-3">
          <Label htmlFor="native-mfa-code">Email verification code</Label>
          <Input id="native-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required
            value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy || !challenge} />
          <Button type="submit" disabled={busy || !challenge || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</Button>
        </form>
        <Button variant="outline" disabled={busy || (Boolean(challenge) && now - sentAt < 60_000)} onClick={() => void run(sendCode)}>
          {challenge ? 'Resend code' : 'Send verification code'}
        </Button>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="ghost" disabled={busy} onClick={() => void onSignOut()}>Sign out</Button>
    </section>
  </main>;
}
