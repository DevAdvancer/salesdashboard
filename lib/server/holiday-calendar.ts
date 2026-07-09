import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { HolidayCalendarEntry } from "@/lib/types";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

const DEFAULT_HOLIDAY_COLLECTION_ID = "holiday_calendar";
const REQUIRED_HOLIDAY_ATTRIBUTE_KEYS = [
  "holidayDate",
  "name",
  "createdAt",
] as const;

export function mapHolidayCalendarDoc(doc: any): HolidayCalendarEntry {
  const holidayDate =
    typeof doc.holidayDate === "string"
      ? doc.holidayDate
      : typeof doc.date === "string"
        ? doc.date
        : "";

  return {
    $id: doc.$id,
    date: holidayDate,
    name: typeof doc.name === "string" ? doc.name : "Holiday",
    createdAt: typeof doc.createdAt === "string" ? doc.createdAt : "",
    createdById: typeof doc.createdById === "string" ? doc.createdById : null,
    createdByName: typeof doc.createdByName === "string" ? doc.createdByName : null,
  };
}

export async function resolveHolidayCalendarCollectionId(
  databases: any,
): Promise<string> {
  const candidates = Array.from(
    new Set([COLLECTIONS.HOLIDAY_CALENDAR, DEFAULT_HOLIDAY_COLLECTION_ID]),
  ).filter(Boolean);

  for (const collectionId of candidates) {
    try {
      const response = await databases.listAttributes(DATABASE_ID, collectionId);
      const attributeKeys = new Set(
        (response?.attributes ?? [])
          .filter((attribute: any) => attribute?.status === "available")
          .map((attribute: any) => attribute.key),
      );

      if (
        REQUIRED_HOLIDAY_ATTRIBUTE_KEYS.every((key) => attributeKeys.has(key))
      ) {
        return collectionId;
      }
    } catch {
      // Ignore invalid / missing candidate collections and keep probing.
    }
  }

  return COLLECTIONS.HOLIDAY_CALENDAR;
}

export async function listHolidayCalendarEntries(params: {
  databases: any;
  from?: string;
  to?: string;
}): Promise<HolidayCalendarEntry[]> {
  const collectionId = await resolveHolidayCalendarCollectionId(params.databases);
  const queries: string[] = [Query.orderAsc("holidayDate")];
  if (params.from) {
    queries.push(Query.greaterThanEqual("holidayDate", params.from));
  }
  if (params.to) {
    queries.push(Query.lessThanEqual("holidayDate", params.to));
  }

  const docs = await listAllDocuments<any>({
    databases: params.databases,
    databaseId: DATABASE_ID,
    collectionId,
    queries,
    pageLimit: 100,
    maxPages: 50,
  }).catch(() => []);

  return docs.map(mapHolidayCalendarDoc);
}

export async function listHolidayDateKeys(params: {
  databases: any;
  from?: string;
  to?: string;
}): Promise<string[]> {
  const rows = await listHolidayCalendarEntries(params);
  return rows.map((row) => row.date).filter(Boolean);
}
