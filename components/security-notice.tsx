'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { acknowledgeSecurityNotice, hasAcknowledgedSecurityNotice } from '@/app/actions/security-notice';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
export function SecurityNoticeText() {
  return <section className="space-y-4 text-sm leading-relaxed">
    <h2 className="text-xl font-semibold">Security Notice · CRM HUB v6.0</h2>
    <p>Your account is personal to you. Keep your password and verification codes confidential. You are responsible for protecting your account and reporting suspicious activity promptly to your TL, manager or administrator. Sharing credentials or failing to report a known problem can leave your account exposed and you accountable for its use.</p>
    <p>Each login requires a verification code sent to your registered email. Never share this code. Report any sign-in code you did not request.</p>
    <p>Native Appwrite multi-factor authentication is required for every CRM role. Your email must be verified before enrollment. A successful code verification lasts up to 12 hours, or until your native session expires.</p>
    <p>Attendance is recorded separately and does not block CRM access. Actions are attributed to your signed-in account. Read this notice any time in Settings - Security Notice.</p>
  </section>;
}
export function SecurityNotice() {
  const { user } = useAuth();
  const userId = user?.$id;
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPending(false); setAgreed(false);
    if (userId) void hasAcknowledgedSecurityNotice().then(ack => { if (active) setPending(!ack); })
      .catch(() => { if (active) { setPending(true); setError('Could not load your acknowledgment. Please try agreeing again.'); } });
    return () => { active = false; };
  }, [userId]);
  const accept = async () => {
    setSaving(true); setError('');
    try { await acknowledgeSecurityNotice(); setPending(false); }
    catch { setError('Could not save your agreement. Please try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog open={pending} onOpenChange={() => {}}><DialogContent className="max-h-[90vh] overflow-y-auto [&>button:last-child]:hidden" onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
    <DialogTitle>Security Notice</DialogTitle><DialogDescription>Please read and acknowledge the CRM HUB v6.0 security changes.</DialogDescription>
    <SecurityNoticeText />
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />I have read and agree to these security changes and my account responsibilities.</label>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={!agreed || saving} onClick={() => void accept()}>{saving ? 'Saving…' : 'I agree'}</Button>
  </DialogContent></Dialog>;
}
