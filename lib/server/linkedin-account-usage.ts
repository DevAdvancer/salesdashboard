import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

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

export async function getLinkedinAccountUsageByAccount(
  databases: Databases,
  accountIds: string[],
  dateSent: string,
): Promise<Record<string, number>> {
  const usage = Object.fromEntries(accountIds.map((id) => [id, 0])) as Record<string, number>;
  if (accountIds.length === 0) return usage;

  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  for (let offset = 0; offset < accountIds.length; offset += 100) {
    const rows = await listAllDocuments<{ accountId: string }>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
      queries: [
        Query.equal("accountId", accountIds.slice(offset, offset + 100)),
        Query.equal("dateSent", dateSent),
        Query.select(["$id", "accountId"]),
      ],
    });
    for (const row of rows) {
      if (Object.hasOwn(usage, row.accountId)) usage[row.accountId] += 1;
    }
  }
  return usage;
}
