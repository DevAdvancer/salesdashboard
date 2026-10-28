import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";

type Databases = Awaited<ReturnType<typeof createAdminClient>>["databases"];

/** Count every request recorded for the account on this business date. */
export async function getLinkedinAccountUsage(
  databases: Databases,
  accountId: string,
  dateSent: string,
): Promise<number> {
  // Requests can be written by another server instance or the extension. A cached
  // quota can otherwise let the account exceed its daily limit for up to two hours.
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, [
    Query.equal("accountId", accountId),
    Query.equal("dateSent", dateSent),
    Query.select(["$id"]),
    Query.limit(1),
  ]);
  return typeof response.total === "number" ? response.total : response.documents.length;
}

/** One count query per account: Appwrite returns `total` without reading every
 * request row, so a busy account costs one read instead of one per send. */
export async function getLinkedinAccountUsageByAccount(
  databases: Databases,
  accountIds: string[],
  dateSent: string,
): Promise<Record<string, number>> {
  const counts = await Promise.all(
    accountIds.map(async (id) => [id, await getLinkedinAccountUsage(databases, id, dateSent)] as const),
  );
  return Object.fromEntries(counts);
}
