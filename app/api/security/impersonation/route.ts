import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { resolveImpersonationOperator, resolveSecurityIdentity, CrmAccessError, CRM_ACCESS_COOKIE } from '@/lib/server/crm-access';
import { CRM_IMPERSONATION_COOKIE, hasImpersonationCapability, validImpersonationId } from '@/lib/utils/crm-impersonation';
import { securityDatabase } from '@/lib/server/crm-access';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { appendLeadHistory } from '@/lib/server/lead-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const sameOrigin = (request: NextRequest) => request.headers.get('origin') === request.nextUrl.origin;
function failure(error: unknown) {
  return error instanceof CrmAccessError ? json({ error: error.message }, error.status)
    : json({ error: 'Could not switch users. Check the selected account and try again.' }, 403);
}

export async function GET(request: NextRequest) {
  try {
    const operator = await resolveImpersonationOperator(request.cookies);
    const canImpersonate = hasImpersonationCapability(operator.account);
    const target = request.cookies.get(CRM_IMPERSONATION_COOKIE)?.value;
    const active = target ? await resolveSecurityIdentity(request.cookies) : null;
    return json({ canImpersonate, operator: { id: operator.user.$id, name: operator.user.name },
      active: active ? { id: active.user.$id, name: active.user.name } : null });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const operator = await resolveImpersonationOperator(request.cookies);
    if (!hasImpersonationCapability(operator.account)) throw new CrmAccessError(403, 'Your Appwrite account does not have impersonation capability.');
    const body = await request.json();
    const selection = typeof body.target === 'string' ? body.target.trim() : '';
    if (!selection || selection.length > 320) return json({ error: 'Enter a CRM user ID or email.' }, 400);
    let targetId = selection;
    if (selection.includes('@')) {
      const result = await securityDatabase().listDocuments(DATABASE_ID, COLLECTIONS.USERS,
        [Query.equal('email', selection.toLowerCase()), Query.limit(2), Query.select(['$id'])]);
      if (result.documents.length !== 1) throw new CrmAccessError(404, 'An active matching CRM account was not found.');
      targetId = result.documents[0].$id;
    }
    if (!validImpersonationId(targetId) || targetId === operator.user.$id) return json({ error: 'Choose another CRM user. Use Stop impersonating to return to your account.' }, 400);
    // The cookie selects a target only. Appwrite must authorize the operator's
    // real session with the native impersonation header before any cookie is set.
    const identity = await resolveSecurityIdentity({ get: name => name === CRM_IMPERSONATION_COOKIE
      ? { value: targetId } : request.cookies.get(name) });
    await appendLeadHistory(securityDatabase(), { eventType: 'IMPERSONATION_START',
      actor: { id: operator.user.$id, name: operator.user.name, impersonatedUserId: targetId, impersonatedUserName: identity.user.name },
      payload: { targetUserId: targetId } });
    const response = json({ redirect: identity.user.role === 'compliance' ? '/compliance-dashboard'
      : identity.user.department === 'resume' ? '/resume-dashboard' : '/dashboard' });
    response.cookies.set(CRM_IMPERSONATION_COOKIE, targetId, { httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', path: '/', expires: new Date(identity.session.expire) });
    response.cookies.delete(CRM_ACCESS_COOKIE);
    return response;
  } catch (error) { return failure(error); }
}

/** Always permit an explicit exit, including after capability revocation. */
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  const targetId = request.cookies.get(CRM_IMPERSONATION_COOKIE)?.value;
  if (targetId) {
    try {
      const operator = await resolveImpersonationOperator(request.cookies);
      await appendLeadHistory(securityDatabase(), { eventType: 'IMPERSONATION_STOP',
        actor: { id: operator.user.$id, name: operator.user.name, impersonatedUserId: targetId }, payload: { targetUserId: targetId } });
    } catch { /* Exiting must work even if the session/capability was revoked. */ }
  }
  const response = json({ redirect: '/login' });
  response.cookies.delete(CRM_IMPERSONATION_COOKIE);
  response.cookies.delete(CRM_ACCESS_COOKIE);
  return response;
}
