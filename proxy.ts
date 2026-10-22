import { NextRequest, NextResponse } from 'next/server';
import { assertCrmAccess, CrmAccessError, crmAccessEnabled } from '@/lib/server/crm-access';
import { bypassCrmGate } from '@/lib/utils/crm-access-policy';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!crmAccessEnabled() || bypassCrmGate(path, request.method, request.headers.has('next-action'))) return NextResponse.next();
  try {
    await assertCrmAccess(request.cookies);
    return NextResponse.next();
  } catch (error) {
    const status = error instanceof CrmAccessError ? error.status : 503;
    if (path.startsWith('/api/') || request.method !== 'GET') {
      return NextResponse.json({ error: error instanceof CrmAccessError ? error.message : 'CRM access verification is unavailable. Please retry.',
        code: error instanceof CrmAccessError ? error.code : 'ACCESS_CHECK_UNAVAILABLE' },
      { status, headers: { 'Cache-Control': 'no-store' } });
    }
    // The public sign-in page mounts the gate for an existing signed-in user.
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|css|js|map)$).*)'],
};
