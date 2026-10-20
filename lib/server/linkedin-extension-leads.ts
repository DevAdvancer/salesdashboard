import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { normalizeStoredProfileUrl } from "@/lib/utils/linkedin-extension-url";

type Databases = Awaited<ReturnType<typeof createAdminClient>>["databases"];

/** Leads keep URLs in JSON. Scan projected data so legacy case/encoding cannot hide a match. */
export async function linkedinProfileHasLead(databases: Databases, targetUrl: string): Promise<boolean> {
  const leads = await listAllDocuments<{ data: string }>({
    databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
    queries: [Query.select(["$id", "data"])],
  });
  // Never label a truncated scan as "not found".
  if (leads.length >= 100_000) throw new Error("Lead lookup exceeded its scan limit.");
  return leads.some(lead => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(lead.data); } catch { return false; }
    if (!data || typeof data !== "object") return false;
    return [data.linkedinProfileUrl, data.linkedinProfile, data.field_16].some(value => {
      if (typeof value !== "string" || !value.trim()) return false;
      try { return normalizeStoredProfileUrl(value) === targetUrl; } catch { return false; }
    });
  });
}
