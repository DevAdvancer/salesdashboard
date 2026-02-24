import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("outlook_access_token");

  if (token && token.value) {
    return NextResponse.json({ connected: true });
  }

  return NextResponse.json({ connected: false });
}
