'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
// import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite'; // Server-side imports only

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const MOCK_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID || 'mock_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';

/**
 * Get all mock attempts for a user and a set of lead IDs
 */
export async function getMockAttempts(userId: string, leadIds: string[]) {
    if (!userId || !leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        // Appwrite query limits might apply, but for pagination (10 items) it's fine.
        const response = await databases.listDocuments(
            DATABASE_ID,
            MOCK_ATTEMPTS_COLLECTION_ID,
            [
                Query.equal('userId', userId),
                // Use equal for IN query (Appwrite convention for arrays) or multiple queries if needed.
                // Assuming leadIds is array of strings and we want attempts where leadId is in leadIds.
                Query.equal('leadId', leadIds)
            ]
        );

        return response.documents.map((doc: any) => ({
            $id: doc.$id,
            leadId: doc.leadId,
            userId: doc.userId,
            attemptCount: doc.attemptCount,
            lastAttemptAt: doc.lastAttemptAt
        }));
    } catch (error: any) {
        console.error('Error getting mock attempts:', error);
        return []; // Return empty array on error
    }
}

/**
 * Record a new mock attempt or update an existing one
 */
export async function recordMockAttempt(userId: string, leadId: string) {
    if (!userId || !leadId) throw new Error('Invalid input');

    try {
        const { databases } = await createAdminClient();
        const collectionId = MOCK_ATTEMPTS_COLLECTION_ID;

        // Fetch User to check Role
        const user = await databases.getDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId
        );

        const isAdmin = user.role === 'admin';

        // Check for existing attempt
        const existing = await databases.listDocuments(
            DATABASE_ID,
            collectionId,
            [
                Query.equal('userId', userId),
                Query.equal('leadId', leadId)
            ]
        );

        const now = new Date().toISOString();

        if (existing.total > 0) {
            const attempt = existing.documents[0];

            // Security check: max 2 attempts (SKIP IF ADMIN)
            if (!isAdmin && attempt.attemptCount >= 2) {
                throw new Error('Maximum attempts reached');
            }

            // Security check: cooldown 30 min (SKIP IF ADMIN)
            const lastAttempt = new Date(attempt.lastAttemptAt);
            const diffMs = new Date(now).getTime() - lastAttempt.getTime();
            const diffMinutes = diffMs / (1000 * 60);

            // Allow retry if > 30 mins (SKIP IF ADMIN)
            if (!isAdmin && diffMinutes < 30) {
                throw new Error('Cooldown period active');
            }

            // Update attempt
            // If admin, keep the same count (doesn't increment)
            const newCount = isAdmin ? attempt.attemptCount : attempt.attemptCount + 1;

            const updated = await databases.updateDocument(
                DATABASE_ID,
                collectionId,
                attempt.$id,
                {
                    attemptCount: newCount,
                    lastAttemptAt: now
                }
            );

            return {
                $id: updated.$id,
                leadId: updated.leadId,
                userId: updated.userId,
                attemptCount: updated.attemptCount,
                lastAttemptAt: updated.lastAttemptAt
            };
        } else {
            const newAttempt = await databases.createDocument(
                DATABASE_ID,
                collectionId,
                ID.unique(),
                {
                    leadId,
                    userId,
                    attemptCount: 1,
                    lastAttemptAt: now
                }
            );

            return {
                $id: newAttempt.$id,
                leadId: newAttempt.leadId,
                userId: newAttempt.userId,
                attemptCount: newAttempt.attemptCount,
                lastAttemptAt: newAttempt.lastAttemptAt
            };
        }
    } catch (error: any) {
        console.error('Error recording mock attempt:', error);
        throw error;
    }
}
