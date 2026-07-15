import { NextResponse, type NextRequest } from "next/server";
import { checkAndNotifyResumeSla } from "@/lib/services/resume-sla-service";

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = getAuthorizationToken(request) ?? request.headers.get("x-cron-secret");
  return Boolean(provided) && provided === expected;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await checkAndNotifyResumeSla();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Resume SLA cron failed:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
