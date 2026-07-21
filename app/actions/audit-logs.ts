'use server';

import { Query } from 'appwrite';
import { databases } from '@/lib/appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

export interface AuditLogFilterOptions {
  actions: string[];
  targetTypes: string[];
}

/**
 * Scans the most recent 5,000 audit logs and extracts all unique actions and target types
 * to populate filter dropdowns dynamically.
 */
export async function getAuditLogFilterOptionsAction(): Promise<AuditLogFilterOptions> {
  // In a real app we'd authenticate the caller, but the audit collection is secured
  // at the Appwrite level by role, and we just need the options here.
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      [
        Query.limit(5000),
        Query.select(['action', 'targetType']),
        Query.orderDesc('performedAt'),
      ]
    );

    const actionSet = new Set<string>();
    const targetTypeSet = new Set<string>();

    for (const doc of response.documents) {
      if (doc.action) actionSet.add(doc.action);
      if (doc.targetType) targetTypeSet.add(doc.targetType);
    }

    return {
      actions: Array.from(actionSet).sort(),
      targetTypes: Array.from(targetTypeSet).sort(),
    };
  } catch (error: any) {
    console.error('Error fetching dynamic audit log filter options:', error);
    // Return empty arrays on failure so the UI just has empty dropdowns rather than crashing
    return { actions: [], targetTypes: [] };
  }
}
