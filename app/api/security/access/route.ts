import { NextRequest, NextResponse } from 'next/server';
import { crmAccessEnabled, CrmAccessError, evaluateCrmAccess, resolveSecurityIdentity } from '@/lib/server/crm-access';
import { publicUser } from '@/lib/server/crm-browser-data';
import { getRequestMaintenanceStatus, isMaintenanceManager } from '@/lib/server/maintenance';
import { getTodayEst } from '@/lib/utils/est-date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Read native session state only. Codes are sent and verified directly by Appwrite. */
export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get('view');
  if (view === 'approvals') return json({ error: 'Attendance access approvals have been retired.' }, 410);
  if (!crmAccessEnabled() && view !== 'bootstrap') return json({ state: 'disabled' });
  try {
    const identity = await resolveSecurityIdentity();
    if (view === 'bootstrap') {
      const maintenance = await getRequestMaintenanceStatus(request.headers);
      if (maintenance.active && !isMaintenanceManager(identity.account)) return json({ error: 'CRM maintenance is in progress.' }, 503);
      return json({ user: publicUser(identity.user as unknown as Record<string, unknown>, true),
        status: crmAccessEnabled() ? await evaluateCrmAccess(identity) : { state: 'disabled', dateKey: getTodayEst() } });
    }
    return json(await evaluateCrmAccess(identity));
  } catch (error) {
    if (error instanceof CrmAccessError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: 'CRM access verification is temporarily unavailable. Please retry.' }, 503);
  }
}

/** Old tabs must reload into native MFA; there is no custom OTP fallback. */
export async function POST() {
  return json({ error: 'CRM verification moved to native Appwrite MFA. Reload this page to continue.', code: 'NATIVE_MFA_REQUIRED' }, 410);
}
