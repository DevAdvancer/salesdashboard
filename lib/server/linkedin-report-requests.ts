import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { LinkedinRequest } from "@/lib/types";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import type { createAdminClient } from "@/lib/server/appwrite";

function dateKey(value: string): string {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Enter a valid date range.");
  }
  return value;
}

export function linkedinReportUtcBounds(startDate: string, endDate: string) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (end < start) throw new Error("End date must be on or after start date.");
  const [year, month, day] = end.split("-").map(Number);
  const wideEnd = new Date(Date.UTC(year, month - 1, day + 2)).toISOString().slice(0, 10);
  return { start, end, startUtc: `${start}T00:00:00.000Z`,
    endUtcExclusive: `${wideEnd}T00:00:00.000Z` };
}

/** Fetch the exact request set shown by LinkedIn Reports and its export. */
export async function listLinkedinReportRequests(input: {
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"];
  startDate: string;
  endDate: string;
  teamLeadId?: string | null;
}): Promise<LinkedinRequest[]> {
  const { start, end, startUtc, endUtcExclusive } =
    linkedinReportUtcBounds(input.startDate, input.endDate);
  const queries = [
    Query.greaterThanEqual("$createdAt", startUtc),
    Query.lessThan("$createdAt", endUtcExclusive),
    Query.orderAsc("$id"),
  ];
  if (input.teamLeadId && input.teamLeadId !== "all") {
    queries.unshift(Query.equal("teamLeadId", input.teamLeadId));
  }
  const requests = await listAllDocuments<LinkedinRequest>({
    databases: input.databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_REQUESTS, queries,
  });
  return requests.filter(request => {
    if (!request.$createdAt) return false;
    const created = getCurrentEasternIsoDate(new Date(request.$createdAt));
    return created >= start && created <= end;
  });
}
