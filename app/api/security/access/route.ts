import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCrmAccess, crmAccessEnabled, CrmAccessError, decideAccessRequest, evaluateCrmAccess, listAccessApprovals,
  resolveSecurityIdentity, securityDatabase, startDelegateOtp, startLoginOtp, submitDelegateRequest } from '@/lib/server/crm-access';
import { effectiveCrmAuditActor } from '@/lib/server/crm-access';
import { consumeEmailOtp, CRM_PROOF_COOKIE, PROOF_TTL_MS, signProof } from '@/lib/server/crm-security-store';
import { publicUser } from '@/lib/server/crm-browser-data';
import { getRequestMaintenanceStatus, isMaintenanceManager } from '@/lib/server/maintenance';
import { getTodayEst } from '@/lib/utils/est-date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().regex(/^[a-zA-Z0-9._-]{1,36}$/);
const inputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('send-login-code') }).strict(),
  z.object({ operation: z.literal('verify-login'), challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ operation: z.literal('send-delegate-code'), name: z.string().trim().min(1).max(255) }).strict(),
  z.object({ operation: z.literal('request-cover'), challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ operation: z.literal('decide'), requestId: id, approve: z.boolean() }).strict(),
]);
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
function failure(error: unknown, approvals = false) {
  if (error instanceof CrmAccessError) return json({ error: error.message, code: error.code }, error.status);
  // OTP errors are intentionally curated; never return raw Appwrite diagnostics.
  const messages = ['Please wait a minute before requesting another code.', 'Too many code requests. Please try again later.',
    'The verification email could not be sent. Please contact your administrator.', 'Enter the six-digit code.',
    'This code has expired or belongs to another sign-in.', 'Too many attempts. Request a new code.',
    'The verification code is incorrect.', 'The verification code is incorrect or has expired.', 'This code has already been used.',
    'The registered email does not match the authentication account. Contact your administrator.',
    'The verification code has expired. Request a new code.'];
  if (error instanceof Error && messages.includes(error.message)) return json({ error: error.message }, 400);
  console.error('CRM access request failed', { code: (error as { code?: number })?.code, type: (error as { type?: string })?.type, approvals });
  return json({ error: approvals ? 'Delegate approval requests could not be loaded. Please retry.' : 'CRM access verification could not be completed. Please retry or contact your administrator.' }, 503);
}
export async function GET(request: NextRequest) {
  const bootstrap = request.nextUrl.searchParams.get('view') === 'bootstrap';
  if (!crmAccessEnabled() && !bootstrap) return json({ state: 'disabled' });
  try {
    const identity = await resolveSecurityIdentity();
    if (bootstrap) {
      const maintenance = await getRequestMaintenanceStatus(request.headers);
      if (maintenance.active && !isMaintenanceManager(identity.account)) return json({ error: 'CRM maintenance is in progress.' }, 503);
      return json({ user: publicUser(identity.user as unknown as Record<string, unknown>, true),
        status: crmAccessEnabled() ? await evaluateCrmAccess(identity) : { state: 'disabled', dateKey: getTodayEst() } });
    }
    if (request.nextUrl.searchParams.get('view') === 'approvals') {
      await assertCrmAccess(undefined, identity);
      const actor = await effectiveCrmAuditActor({ id: identity.user.$id, name: identity.user.name }, identity);
      return json({ requests: await listAccessApprovals(identity.user, actor.id) });
    }
    return json(await evaluateCrmAccess(identity));
  } catch (error) { return failure(error, request.nextUrl.searchParams.get('view') === 'approvals'); }
}
export async function POST(request: NextRequest) {
  if (!crmAccessEnabled()) return json({ error: 'CRM access protection has not been activated.' }, 409);
  if (request.headers.get('origin') !== request.nextUrl.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Invalid request origin or content type.' }, 403);
  }
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'Request too large.' }, 413);
    const parsed = inputSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: 'Invalid access request.' }, 400);
    const input = parsed.data;
    const identity = await resolveSecurityIdentity();
    if (input.operation === 'send-login-code') return json(await startLoginOtp(identity));
    if (input.operation === 'verify-login') {
      await consumeEmailOtp(securityDatabase(), { userId: identity.user.$id, sessionId: identity.session.$id, purpose: 'login' }, input.challengeId, input.code);
      const expiresAt = Math.min(Date.now() + PROOF_TTL_MS, Date.parse(identity.session.expire));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new CrmAccessError(401, 'Please sign in again.');
      const proof = signProof({ userId: identity.user.$id, sessionId: identity.session.$id, expiresAt });
      (await cookies()).set(CRM_PROOF_COOKIE, proof, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: Math.floor((expiresAt - Date.now()) / 1000),
      });
      return json({ success: true, status: await evaluateCrmAccess({ ...identity, proof }) });
    }
    if (input.operation === 'send-delegate-code') return json(await startDelegateOtp(identity, input.name));
    if (input.operation === 'request-cover') return json(await submitDelegateRequest(identity, input.challengeId, input.code));
    await assertCrmAccess(undefined, identity);
    const actor = await effectiveCrmAuditActor({ id: identity.user.$id, name: identity.user.name }, identity);
    await decideAccessRequest(identity.user, input.requestId, input.approve, actor);
    return json({ success: true });
  } catch (error) { return failure(error); }
}
