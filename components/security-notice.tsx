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
    <p>Monday-Friday, you can access CRM and mark attendance before 10 AM Eastern time. From 10 AM, if you are not marked present, ask your TL or manager to mark you present. Weekends do not require attendance. Email verification is still required every day. Admin, Developer, Monitor and Operations are attendance-exempt.</p>
    <p>If you are covering an absent colleague, ask their TL or manager to assign you as the delegate. On the blocked access screen, enter the assigned delegate’s full name. A code is then sent to the delegate’s registered email. After verification, an authorized TL or manager must approve CRM access. The delegate must be present or attendance-exempt. Approval lasts for that Eastern calendar day and does not mark the absent colleague present.</p>
    <p>The name field appears only when a delegate is assigned. Without an assignment, contact your TL or manager. Read this notice any time in Settings → Security Notice.</p>
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
