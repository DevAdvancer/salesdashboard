import { NextResponse } from "next/server";
import { getMaintenanceStatus } from "@/lib/server/maintenance";

export async function GET() {
  const status = await getMaintenanceStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
