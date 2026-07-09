"use server";

import { ID } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { DATABASE_ID } from "@/lib/constants/appwrite";
import type { HolidayCalendarEntry } from "@/lib/types";
import {
  listHolidayCalendarEntries,
  mapHolidayCalendarDoc,
  resolveHolidayCalendarCollectionId,
} from "@/lib/server/holiday-calendar";

function canManageHolidayCalendar(role: string) {
  return role === "admin";
}

export async function listHolidayCalendarAction(input: {
  currentUserId: string;
  from?: string;
  to?: string;
}): Promise<HolidayCalendarEntry[]> {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();
  return listHolidayCalendarEntries({
    databases,
    from: input.from,
    to: input.to,
  });
}

export async function createHolidayCalendarEntryAction(input: {
  currentUserId: string;
  date: string;
  name: string;
}): Promise<HolidayCalendarEntry> {
  await assertAuthenticatedUserId(input.currentUserId);
  const actor = await getAuthenticatedUserDoc();
  if (!canManageHolidayCalendar(actor.role)) {
    throw new Error("Unauthorized");
  }

  const date = input.date.trim();
  const name = input.name.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Holiday date is required.");
  }
  if (!name) {
    throw new Error("Holiday name is required.");
  }

  const { databases } = await createAdminClient();
  const collectionId = await resolveHolidayCalendarCollectionId(databases);
  try {
    const doc = await databases.createDocument(
      DATABASE_ID,
      collectionId,
      ID.unique(),
      {
        holidayDate: date,
        name,
        createdAt: new Date().toISOString(),
        createdById: actor.$id,
        createdByName: actor.name,
      },
    );

    return mapHolidayCalendarDoc(doc);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : "";
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : undefined;

    if (
      code === 409 ||
      message.includes("already exists") ||
      message.includes("unique")
    ) {
      throw new Error("A holiday already exists for that date.");
    }

    throw error;
  }
}

export async function deleteHolidayCalendarEntryAction(input: {
  currentUserId: string;
  holidayId: string;
}): Promise<void> {
  await assertAuthenticatedUserId(input.currentUserId);
  const actor = await getAuthenticatedUserDoc();
  if (!canManageHolidayCalendar(actor.role)) {
    throw new Error("Unauthorized");
  }

  const { databases } = await createAdminClient();
  const collectionId = await resolveHolidayCalendarCollectionId(databases);
  await databases.deleteDocument(
    DATABASE_ID,
    collectionId,
    input.holidayId,
  );
}
