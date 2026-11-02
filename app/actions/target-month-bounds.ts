"use server";

import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { readReportingWindows, readReportingWindowsFresh, readTargetMonthBound, invalidateReportingCalendar } from '@/lib/server/reporting-calendar';
import { assertReportingWindow, calendarMonthWindow } from '@/lib/utils/reporting-period';

export interface TargetMonthBound {
  $id: string;
  monthKey: string;
  leadsFromIso: string;
  leadsToIso: string;
}

export async function getTargetMonthBound(monthKey: string): Promise<TargetMonthBound | null> {
  await getAuthenticatedUserDoc();
  calendarMonthWindow(monthKey);
  return readTargetMonthBound(monthKey);
}

export async function getReportingCalendarAction() {
  await getAuthenticatedUserDoc();
  return readReportingWindows();
}

export async function saveTargetMonthBound(monthKey: string, leadsFromIso: string, leadsToIso: string) {
  const user = await getAuthenticatedUserDoc();
  if (!user || (user.role !== "admin" && user.role !== "developer")) {
    throw new Error("Unauthorized");
  }

  const windows = await readReportingWindowsFresh();
  try { assertReportingWindow({ monthKey, leadsFromIso, leadsToIso }, windows); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'Choose a valid reporting window.' }; }
  const { databases } = await createAdminClient();
  const existing = windows.find(window => window.monthKey === monthKey);

  if (existing) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, existing.$id, {
      leadsFromIso,
      leadsToIso,
    });
  } else {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, monthKey, {
      monthKey,
      leadsFromIso,
      leadsToIso,
    });
  }
  invalidateReportingCalendar();
  return { ok: true as const };
}
