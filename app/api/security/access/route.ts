import { NextRequest, NextResponse } from 'next/server';
import { accessCookieFor, crmAccessEnabled, CrmAccessError, evaluateCrmAccess, resolveSecurityIdentity, type SecurityIdentity } from '@/lib/server/crm-access';
import { publicUser } from '@/lib/server/crm-browser-data';
import { getTodayEst } from '@/lib/utils/est-date';
import { CRM_IMPERSONATION_COOKIE } from '@/lib/utils/crm-impersonation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
/** Lets the proxy admit this sign-in's next requests without Appwrite calls. */
function withAccessCookie(request: NextRequest, response: NextResponse, identity: SecurityIdentity) {
  if (!crmAccessEnabled()) return response;
  const cookie = accessCookieFor(identity, request.cookies);
  if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

/** Read native session state only. Codes are sent and verified directly by Appwrite. */
export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get('view');
  if (view === 'approvals') return json({ error: 'Attendance access approvals have been retired.' }, 410);
  if (!crmAccessEnabled() && view !== 'bootstrap') return json({ state: 'disabled' });
  try {
    const identity = await resolveSecurityIdentity();
    if (view === 'bootstrap') {
      return withAccessCookie(request, json({ user: { ...publicUser(identity.user as unknown as Record<string, unknown>, true),
        ...(identity.operator ? { impersonatorUserId: identity.operator.user.$id, impersonatorName: identity.operator.user.name } : {}) },
        status: crmAccessEnabled() ? await evaluateCrmAccess(identity) : { state: 'disabled', dateKey: getTodayEst() } }), identity);
    }
    return withAccessCookie(request, json(await evaluateCrmAccess(identity)), identity);
  } catch (error) {
    const response = error instanceof CrmAccessError ? json({ error: error.message, code: error.code }, error.status)
      : json({ error: 'CRM access verification is temporarily unavailable. Please retry.' }, 503);
    // Recover the operator's own login if a target is removed or capability is revoked.
    if (request.cookies.get(CRM_IMPERSONATION_COOKIE)?.value) response.cookies.delete(CRM_IMPERSONATION_COOKIE);
    return response;
  }
}

/** Old tabs must reload into native MFA; there is no custom OTP fallback. */
export async function POST() {
  return json({ error: 'CRM verification moved to native Appwrite MFA. Reload this page to continue.', code: 'NATIVE_MFA_REQUIRED' }, 410);
}
