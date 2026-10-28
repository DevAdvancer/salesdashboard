import { Account, Client } from "node-appwrite";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { accessCookieFor, CRM_ACCESS_COOKIE, crmAccessEnabled, evaluateCrmAccess, resolveSecurityIdentity } from '@/lib/server/crm-access';
import { clearCrmIdentityCache } from '@/lib/server/crm-identity-cache';
import { publicUser } from '@/lib/server/crm-browser-data';
import { getTodayEst } from '@/lib/utils/est-date';

const APPWRITE_JWT_COOKIE = "crm_appwrite_jwt";

function createJwtClient(jwt: string) {
  return new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setJWT(jwt);
}

export async function POST(request: NextRequest) {
  const { jwt, bootstrap } = (await request.json().catch(() => ({}))) as { jwt?: string; bootstrap?: boolean };

  if (!jwt) {
    return NextResponse.json({ error: "Missing session token" }, { status: 400 });
  }

  const cookieStore = await cookies();
  let identity;
  // Reads the new JWT; an access cookie issued for the previous one no longer matches.
  const reader = { get: (name: string) => name === APPWRITE_JWT_COOKIE ? { value: jwt } : cookieStore.get(name) };
  try {
    // Either path validates the JWT against Appwrite before it is stored.
    if (bootstrap === true) identity = await resolveSecurityIdentity(reader);
    else await new Account(createJwtClient(jwt)).get();
  } catch {
    return NextResponse.json({ error: "Invalid session token" }, { status: 401 });
  }

  cookieStore.set(APPWRITE_JWT_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });

  const accessCookie = identity && crmAccessEnabled() ? accessCookieFor(identity, reader) : null;
  if (accessCookie) cookieStore.set(accessCookie.name, accessCookie.value, accessCookie.options);
  if (identity) return NextResponse.json({ success: true, user: publicUser(identity.user as unknown as Record<string, unknown>, true),
    status: crmAccessEnabled() ? await evaluateCrmAccess(identity) : { state: 'disabled', dateKey: getTodayEst() } }, { headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(APPWRITE_JWT_COOKIE);
  cookieStore.delete(CRM_ACCESS_COOKIE);
  // Remove a legacy cookie during migration; it is never read or accepted.
  cookieStore.delete('crm_email_verified');
  clearCrmIdentityCache();
  return NextResponse.json({ success: true });
}
