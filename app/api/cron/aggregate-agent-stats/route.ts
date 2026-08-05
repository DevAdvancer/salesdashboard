import { NextResponse, type NextRequest } from "next/server";
import { aggregateAgentStatsForDates } from "@/lib/server/stats-aggregator";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1];
}

export async function GET(request: NextRequest) {
  const token = getAuthorizationToken(request);
  if (token !== process.env.CRON_SECRET && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Process today and the last 3 days to catch late payment entries or late lead closures
    const dateKeys = [];
    const today = new Date();
    for (let i = 0; i < 4; i++) {
      dateKeys.push(format(subDays(today, i), "yyyy-MM-dd"));
    }

    await aggregateAgentStatsForDates(dateKeys);

    return NextResponse.json({ success: true, processedDays: dateKeys.length });
  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
