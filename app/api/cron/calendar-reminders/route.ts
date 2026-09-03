import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import { createNotificationRecord } from "@/lib/server/notifications";

// This cron job is scheduled to run every 5 minutes (or however often configured)
// It finds events where the date (which is stored as YYYY-MM-DDTHH:mm in EST) is <= current EST time.

function getEstDateTimeString(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const find = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${find('year')}-${find('month')}-${find('day')}T${find('hour')}:${find('minute')}`;
}

export async function GET(request: Request) {
  // Optional: check for cron secret
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const { databases } = await createAdminClient();

    const currentEstTimeStr = getEstDateTimeString();

    // Fetch calendar events that are due (date <= currentEstTimeStr) and haven't been sent
    const eventsResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.CALENDAR_EVENTS,
      [
        Query.lessThanEqual("date", currentEstTimeStr),
        Query.equal("reminderEnabled", true),
        Query.equal("reminderSent", false),
        Query.limit(100), // process in batches if many
      ]
    );

    let sentCount = 0;

    for (const event of eventsResponse.documents) {
      // Create notification
      const bodyText = event.notes
        ? `${event.type} with ${event.candidateName}. Notes: ${event.notes}`
        : `${event.type} with ${event.candidateName}`;
        
      await createNotificationRecord(databases, {
        recipientId: event.userId,
        type: "calendar_reminder",
        title: "Calendar Reminder",
        body: bodyText,
        targetId: event.$id,
        targetType: "calendar",
      });

      // Mark event as reminderSent = true
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.CALENDAR_EVENTS,
        event.$id,
        {
          reminderSent: true,
          updatedAt: new Date().toISOString(),
        }
      );

      sentCount++;
    }

    return NextResponse.json({
      success: true,
      sentCount,
      message: `Processed ${sentCount} calendar reminders.`,
    });
  } catch (error) {
    console.error("Cron /calendar-reminders error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
