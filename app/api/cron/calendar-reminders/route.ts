import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { Query, ID } from "node-appwrite";
import { getTodayEst } from "@/lib/utils/est-date";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { isWorkingDateKey } from "@/lib/utils/holiday-calendar";
import { createNotificationRecord } from "@/lib/server/notifications";

// This cron job is scheduled to run daily at 9:00 AM EST (14:00 UTC during standard time / 13:00 UTC during DST)
// We use 14:00 UTC in vercel.json. We can check if it's the correct day here if needed, but since it's cron we just process.

export async function GET(request: Request) {
  // Optional: check for cron secret
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const { databases } = await createAdminClient();

    // Get today's date in EST
    const todayStr = getTodayEst();
    
    // Check if working day
    const holidays = await listHolidayDateKeys({ databases, from: todayStr, to: todayStr });
    if (!isWorkingDateKey(todayStr, holidays)) {
      return NextResponse.json({ success: true, skipped: true, reason: "Not a working day" });
    }

    const startOfDayStr = `${todayStr}T00:00:00.000Z`;
    const endOfDayStr = `${todayStr}T23:59:59.999Z`;

    // Fetch calendar events for today that have reminderEnabled = true and reminderSent = false
    const eventsResponse = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.CALENDAR_EVENTS,
      [
        Query.greaterThanEqual("date", startOfDayStr),
        Query.lessThanEqual("date", endOfDayStr),
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
