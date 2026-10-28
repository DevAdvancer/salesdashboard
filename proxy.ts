import { NextRequest, NextResponse } from 'next/server';
import { assertCrmAccessForProxy, CRM_ACCESS_COOKIE, CRM_ACCESS_PASS_HEADER, CrmAccessError, crmAccessEnabled } from '@/lib/server/crm-access';
import { bypassCrmGate } from '@/lib/utils/crm-access-policy';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Never let a browser-supplied copy of the internal access pass reach a handler.
  // (Handlers also verify its signature, account and session, so a forged value is
  // rejected even on paths this proxy does not run for.)
  const forwarded = new Headers(request.headers);
  forwarded.delete(CRM_ACCESS_PASS_HEADER);
  const next = () => NextResponse.next({ request: { headers: forwarded } });
  if (!crmAccessEnabled() || bypassCrmGate(path, request.method, request.headers.has('next-action'))) return next();
  try {
    const { pass, cookie } = await assertCrmAccessForProxy(request.cookies);
    // Hand the decision just made to this same request's handler so it does not
    // re-read the user record. The pass is internal and short-lived.
    if (pass) forwarded.set(CRM_ACCESS_PASS_HEADER, pass);
    const response = next();
    // Later requests are admitted from this signed cookie without Appwrite calls.
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    const status = error instanceof CrmAccessError ? error.status : 503;
    if (path.startsWith('/api/') || request.method !== 'GET') {
      return withoutAccessCookie(NextResponse.json({ error: error instanceof CrmAccessError ? error.message : 'CRM access verification is unavailable. Please retry.',
        code: error instanceof CrmAccessError ? error.code : 'ACCESS_CHECK_UNAVAILABLE' },
      { status, headers: { 'Cache-Control': 'no-store' } }));
    }
    // The public sign-in page mounts the gate for an existing signed-in user.
    return withoutAccessCookie(NextResponse.redirect(new URL('/login', request.url)));
  }
}
function withoutAccessCookie(response: NextResponse) {
  response.cookies.delete(CRM_ACCESS_COOKIE);
  return response;
}
// Skip paths bypassCrmGate always admits (each handler authorizes itself), public
// downloads and static files: running the proxy there only adds an invocation.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|downloads/|api/(?:appwrite|cron)/|api/security/(?:changes|access)$|api/auth/appwrite-session$|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|css|js|map|mp3|zip|txt|xml|webmanifest)$).*)'],
};
