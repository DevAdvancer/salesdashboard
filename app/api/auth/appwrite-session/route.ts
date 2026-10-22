import { Account, Client } from "node-appwrite";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getRequestMaintenanceStatus, isMaintenanceManager } from "@/lib/server/maintenance";
import { CRM_PROOF_COOKIE } from '@/lib/server/crm-security-store';
import { crmAccessEnabled, evaluateCrmAccess, resolveSecurityIdentity } from '@/lib/server/crm-access';
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
  let authenticated: Awaited<ReturnType<Account["get"]>>;
  let identity;
  try {
    if (bootstrap === true) {
      identity = await resolveSecurityIdentity({ get: name => name === APPWRITE_JWT_COOKIE ? { value: jwt } : cookieStore.get(name) });
      authenticated = identity.account;
    } else authenticated = await new Account(createJwtClient(jwt)).get();
  } catch {
    return NextResponse.json({ error: "Invalid session token" }, { status: 401 });
  }
  const maintenance = await getRequestMaintenanceStatus(request.headers);
  if (maintenance.active && !isMaintenanceManager(authenticated)) {
    return NextResponse.json({ error: "CRM maintenance is in progress", endsAt: maintenance.endsAt },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  cookieStore.set(APPWRITE_JWT_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });

  if (identity) return NextResponse.json({ success: true, user: publicUser(identity.user as unknown as Record<string, unknown>, true),
    status: crmAccessEnabled() ? await evaluateCrmAccess(identity) : { state: 'disabled', dateKey: getTodayEst() } }, { headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(APPWRITE_JWT_COOKIE);
  cookieStore.delete(CRM_PROOF_COOKIE);
  return NextResponse.json({ success: true });
}
