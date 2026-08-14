"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import type { CalendarEvent } from "@/lib/types";

function mapEventDoc(doc: any): CalendarEvent {
  return {
    $id: doc.$id,
    userId: doc.userId,
    type: doc.type,
    candidateName: doc.candidateName,
    notes: doc.notes,
    date: doc.date ? doc.date.substring(0, 10) : "", // Appwrite returns full ISO string
    reminderEnabled: doc.reminderEnabled,
    reminderSent: doc.reminderSent,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listCalendarEventsAction(input: {
  currentUserId: string;
  from?: string;
  to?: string;
}): Promise<CalendarEvent[]> {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();
  const queries = [Query.equal("userId", input.currentUserId)];

  if (input.from) {
    queries.push(Query.greaterThanEqual("date", input.from));
  }
  if (input.to) {
    queries.push(Query.lessThanEqual("date", input.to));
  }
  
  queries.push(Query.orderAsc("date"));
  queries.push(Query.limit(1000));

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    queries
  );

  return response.documents.map(mapEventDoc);
}

export async function createCalendarEventAction(input: {
  currentUserId: string;
  type: string;
  candidateName: string;
  notes?: string;
  date: string;
  reminderEnabled?: boolean;
}): Promise<CalendarEvent> {
  await assertAuthenticatedUserId(input.currentUserId);

  const date = input.date.trim();
  const type = input.type.trim();
  const candidateName = input.candidateName.trim();
  if (!date || !type || !candidateName) {
    throw new Error("Missing required fields.");
  }

  const { databases } = await createAdminClient();
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    ID.unique(),
    {
      userId: input.currentUserId,
      type,
      candidateName,
      notes: input.notes?.trim() || null,
      date,
      reminderEnabled: input.reminderEnabled || false,
      reminderSent: false,
      createdAt: new Date().toISOString(),
    }
  );

  return mapEventDoc(doc);
}

export async function updateCalendarEventAction(input: {
  currentUserId: string;
  eventId: string;
  type?: string;
  candidateName?: string;
  notes?: string;
  date?: string;
  reminderEnabled?: boolean;
}): Promise<CalendarEvent> {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();

  // Verify ownership
  const existing = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    input.eventId
  );
  if (existing.userId !== input.currentUserId) {
    throw new Error("Unauthorized");
  }

  const updates: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.type !== undefined) updates.type = input.type.trim();
  if (input.candidateName !== undefined) updates.candidateName = input.candidateName.trim();
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;
  if (input.date !== undefined) updates.date = input.date.trim();
  if (input.reminderEnabled !== undefined) updates.reminderEnabled = input.reminderEnabled;
  if (updates.reminderEnabled && !existing.reminderEnabled) {
    // If turning reminder back on, reset reminderSent
    updates.reminderSent = false;
  }

  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    input.eventId,
    updates
  );

  return mapEventDoc(doc);
}

export async function deleteCalendarEventAction(input: {
  currentUserId: string;
  eventId: string;
}): Promise<void> {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();
  
  // Verify ownership
  const existing = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    input.eventId
  );
  if (existing.userId !== input.currentUserId) {
    throw new Error("Unauthorized");
  }

  await databases.deleteDocument(
    DATABASE_ID,
    COLLECTIONS.CALENDAR_EVENTS,
    input.eventId
  );
}
