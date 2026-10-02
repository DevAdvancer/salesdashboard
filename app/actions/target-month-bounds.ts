"use server";

import { ID, Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";

export interface TargetMonthBound {
  $id: string;
  monthKey: string;
  leadsFromIso: string;
  leadsToIso: string;
}

export async function getTargetMonthBound(monthKey: string): Promise<TargetMonthBound | null> {
  const { databases } = await createAdminClient();
  const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, [
    Query.equal("monthKey", monthKey),
    Query.limit(1)
  ]);
  
  if (docs.documents.length === 0) return null;
  
  const doc = docs.documents[0];
  return {
    $id: doc.$id,
    monthKey: doc.monthKey,
    leadsFromIso: doc.leadsFromIso,
    leadsToIso: doc.leadsToIso,
  };
}

export async function saveTargetMonthBound(monthKey: string, leadsFromIso: string, leadsToIso: string) {
  const user = await getAuthenticatedUserDoc();
  if (!user || (user.role !== "admin" && user.role !== "developer")) {
    throw new Error("Unauthorized");
  }

  const { databases } = await createAdminClient();
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, [
    Query.equal("monthKey", monthKey),
    Query.limit(1)
  ]);

  if (existing.documents.length > 0) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, existing.documents[0].$id, {
      leadsFromIso,
      leadsToIso,
    });
  } else {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.TARGET_MONTH_BOUNDS, ID.unique(), {
      monthKey,
      leadsFromIso,
      leadsToIso,
    });
  }
}
