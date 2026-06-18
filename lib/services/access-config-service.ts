"use client";

import { databases } from "@/lib/appwrite";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ACCESS_CONFIG_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!;
const ACCESS_RULES_SCOPE = "access-config:rules";

export interface AccessRuleRecord {
  componentKey: string;
  role: string;
  allowed: boolean;
}

export async function listAccessRules(
  scopeKey: string,
  options: { forceRefresh?: boolean } = {},
): Promise<AccessRuleRecord[]> {
  return cacheClientRead(
    ACCESS_RULES_SCOPE,
    [scopeKey],
    async () => {
      const response = await databases.listDocuments(
        DATABASE_ID,
        ACCESS_CONFIG_COLLECTION_ID,
      );

      return response.documents.map((doc) => ({
        componentKey: String(doc.componentKey ?? ""),
        role: String(doc.role ?? ""),
        allowed: doc.allowed === true,
      }));
    },
    { forceRefresh: options.forceRefresh },
  );
}

export function invalidateAccessRulesCache(): void {
  clearClientReadCache(ACCESS_RULES_SCOPE);
}
