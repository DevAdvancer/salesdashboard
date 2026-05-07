import { Account, Client } from "node-appwrite";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const APPWRITE_JWT_COOKIE = "crm_appwrite_jwt";

function createJwtClient(jwt: string) {
  return new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setJWT(jwt);
}

export async function POST(request: NextRequest) {
  const { jwt } = (await request.json().catch(() => ({}))) as { jwt?: string };

  if (!jwt) {
    return NextResponse.json({ error: "Missing session token" }, { status: 400 });
  }

  try {
    await new Account(createJwtClient(jwt)).get();
  } catch {
    return NextResponse.json({ error: "Invalid session token" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(APPWRITE_JWT_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(APPWRITE_JWT_COOKIE);
  return NextResponse.json({ success: true });
}
