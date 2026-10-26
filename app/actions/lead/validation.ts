"use server";
import type { Databases } from 'node-appwrite';
import { Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedAccount } from '@/lib/server/current-user';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { findLeadsForLinkedinProfile } from '@/lib/server/linkedin-lead-protection';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { findLeadDuplicate } from '@/lib/utils/lead-duplicate-match';
import type { LeadData, LeadValidationResult } from '@/lib/types';
import { DATABASE_ID, LEADS_COLLECTION_ID, USERS_COLLECTION_ID } from './constants';

export async function validateLeadUniqueness(data: LeadData, excludeLeadId?: string): Promise<LeadValidationResult & { existingLeadOwnerName?: string; existingLeadAssignedToName?: string }> {
    const { databases } = await createAdminClient();
    const windowStart = new Date();
    windowStart.setFullYear(windowStart.getFullYear() - 1);
    const documents = await listAllDocuments<Record<string, unknown>>({
        databases: databases.uncachedReads || databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: [Query.greaterThanEqual('$createdAt', windowStart.toISOString()),
            Query.orderDesc('$createdAt'), Query.orderDesc('$id')],
        pageLimit: 100,
        maxPages: 10,
    });
    // Profile lookup includes older leads outside the contact preview's window.
    const profile = leadProfileUrl(data);
    if (profile) {
        const candidates = await findLeadsForLinkedinProfile(databases, profile);
        for (const candidate of candidates) {
            const index = documents.findIndex(doc => doc.$id === candidate.$id);
            if (index >= 0) documents[index] = candidate;
            else documents.push(candidate);
        }
    }
    const match = findLeadDuplicate(data, documents, excludeLeadId);
    if (!match) return { isValid: true, canReuse: false };
    return { ...await enrichDuplicateResult(databases, match.doc, match.field), canReuse: match.canReuse };
}

export async function validateLeadUniquenessAction(data: LeadData, excludeLeadId?: string) {
    const user = await getAuthenticatedAccount();
    if (!user) throw new Error("Unauthorized");
    return validateLeadUniqueness(data, excludeLeadId);
}

/**
 * Helper to resolve owner/assignee names for a duplicate lead doc.
 * Returns enriched duplicate result with human-readable agent names.
 */
export async function enrichDuplicateResult(databases: Databases, doc: Record<string, unknown>, duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl'): Promise<{
        isValid: boolean;
        duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl';
        existingLeadId?: string;
        existingBranchId?: string;
        existingLeadOwnerName?: string;
        existingLeadAssignedToName?: string;
        existingLeadStatus?: string;
    }> {
    const branchId = typeof doc.branchId === "string" ? doc.branchId : undefined;
    const status = typeof doc.status === "string" ? doc.status : undefined;
    let ownerName: string | undefined;
    let assignedToName: string | undefined;
    try {
        if (doc.ownerId) {
            const ownerDoc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, doc.ownerId as string);
            ownerName = (ownerDoc as any).name || undefined;
        }
    } catch {
        // Silently ignore if owner doc can't be fetched
    }

    try {
        if (doc.assignedToId) {
            const assignedDoc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, doc.assignedToId as string);
            assignedToName = (assignedDoc as any).name || undefined;
        }
    } catch {
        // Silently ignore if assignedTo doc can't be fetched
    }

    return {
        isValid: false,
        duplicateField,
        existingLeadId: doc.$id as string,
        existingBranchId: branchId,
        existingLeadOwnerName: ownerName,
        existingLeadAssignedToName: assignedToName,
        existingLeadStatus: status,
    };
}
