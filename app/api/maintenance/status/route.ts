import { NextResponse } from "next/server";
import { getRequestMaintenanceStatus } from "@/lib/server/maintenance";

export async function GET(request: Request) {
  const status = await getRequestMaintenanceStatus(request.headers);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
