"use client";

import { Query } from "appwrite";
import { COLLECTIONS, DATABASE_ID, databases } from "@/lib/appwrite";
import { listBranches } from "@/lib/services/branch-service";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";

const AUDIT_REFERENCE_SCOPE = "audit:references";

export interface AuditLogReferenceUser {
  $id: string;
  name: string;
  email: string;
}

export interface AuditLogReferences {
  idToNameMap: Map<string, string>;
  users: AuditLogReferenceUser[];
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseLeadNameFromData(data: unknown): string | null {
  if (typeof data !== "string" || !data.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const firstName = getString(parsed.firstName).trim();
    const lastName = getString(parsed.lastName).trim();
    const company = getString(parsed.company).trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    return fullName || company || null;
  } catch {
    return null;
  }
}

export async function loadAuditLogReferences(): Promise<AuditLogReferences> {
  return cacheClientRead(
    AUDIT_REFERENCE_SCOPE,
    ["default"],
    async () => {
      const map = new Map<string, string>();

      const [branches, users, leads] = await Promise.all([
        listBranches(),
        databases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.USERS,
          [Query.limit(1000)],
        ),
        databases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.LEADS,
          [Query.limit(1000)],
        ).catch((error) => {
          console.warn("Could not load lead names for audit logs:", error);
          return { documents: [] as unknown[] };
        }),
      ]);

      branches.forEach((branch) => map.set(branch.$id, branch.name));

      const userList: AuditLogReferenceUser[] = [];
      users.documents.forEach((doc) => {
        const userDoc = doc as { $id: string; name?: unknown; email?: unknown };
        const name = getString(userDoc.name, getString(userDoc.email, userDoc.$id));
        map.set(userDoc.$id, name);
        userList.push({
          $id: userDoc.$id,
          name,
          email: getString(userDoc.email, ""),
        });
      });

      (leads.documents as Array<{ $id: string; data?: unknown }>).forEach((doc) => {
        const leadName = parseLeadNameFromData(doc.data);
        if (leadName) {
          map.set(doc.$id, leadName);
        }
      });

      return { idToNameMap: map, users: userList };
    },
  );
}

export function invalidateAuditLogReferenceCache(): void {
  clearClientReadCache(AUDIT_REFERENCE_SCOPE);
}
