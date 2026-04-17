'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const INTERVIEW_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_INTERVIEW_ATTEMPTS_COLLECTION_ID || 'interview_attempts';

// Helper: parse attemptCount safely whether stored as string or integer
function parseCount(val: any): number {
    if (typeof val === 'number') return val;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

/**
 * Get all interview attempts for a user and a set of lead IDs
 */
export async function getInterviewAttempts(userId: string, leadIds: string[]) {
    if (!userId || !leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        const response = await databases.listDocuments(
            DATABASE_ID,
            INTERVIEW_ATTEMPTS_COLLECTION_ID,
            [
                Query.equal('userId', userId),
                Query.equal('leadId', leadIds)
            ]
        );

        return response.documents.map((doc: any) => ({
            $id: doc.$id,
            leadId: doc.leadId,
            userId: doc.userId,
            attemptCount: parseCount(doc.attemptCount),
            lastAttemptAt: doc.lastAttemptAt,
            sentSubjects: doc.sentSubjects || [],
        }));
    } catch (error: any) {
        console.error('Error getting interview attempts:', error);
        return [];
    }
}

/**
 * Check if a subject has already been sent for a particular lead by any user.
 * Returns true if the subject is a duplicate.
 */
export async function checkDuplicateInterviewSubject(leadId: string, subject: string): Promise<boolean> {
    if (!leadId || !subject) return false;

    try {
        const { databases } = await createAdminClient();

        const response = await databases.listDocuments(
            DATABASE_ID,
            INTERVIEW_ATTEMPTS_COLLECTION_ID,
            [
                Query.equal('leadId', leadId),
            ]
        );

        for (const doc of response.documents) {
            const sentSubjects: string[] = doc.sentSubjects || [];
            if (sentSubjects.includes(subject)) {
                return true;
            }
        }

        return false;
    } catch (error: any) {
        console.error('Error checking duplicate interview subject:', error);
        return false;
    }
}

/**
 * Record a new interview attempt or update an existing one.
 * attemptCount is stored as a string to match Appwrite String attribute type.
 */
export async function recordInterviewAttempt(userId: string, leadId: string, subject: string) {
    if (!userId || !leadId) throw new Error('Invalid input');

    try {
        const { databases } = await createAdminClient();
        const collectionId = INTERVIEW_ATTEMPTS_COLLECTION_ID;

        const isDuplicate = await checkDuplicateInterviewSubject(leadId, subject);
        if (isDuplicate) {
            throw new Error('An interview with this exact subject has already been sent for this candidate. Please change the details to avoid a duplicate.');
        }

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
            const existingSubjects: string[] = attempt.sentSubjects || [];
            const currentCount = parseCount(attempt.attemptCount);

            const updated = await databases.updateDocument(
                DATABASE_ID,
                collectionId,
                attempt.$id,
                {
                    // Store as string to be compatible with String attribute type in Appwrite
                    attemptCount: String(currentCount + 1),
                    lastAttemptAt: now,
                    sentSubjects: [...existingSubjects, subject],
                }
            );

            return {
                $id: updated.$id,
                leadId: updated.leadId,
                userId: updated.userId,
                attemptCount: parseCount(updated.attemptCount),
                lastAttemptAt: updated.lastAttemptAt,
                sentSubjects: updated.sentSubjects || [],
            };
        } else {
            const newAttempt = await databases.createDocument(
                DATABASE_ID,
                collectionId,
                ID.unique(),
                {
                    leadId,
                    userId,
                    // Store as string to be compatible with String attribute type in Appwrite
                    attemptCount: '1',
                    lastAttemptAt: now,
                    sentSubjects: [subject],
                }
            );

            return {
                $id: newAttempt.$id,
                leadId: newAttempt.leadId,
                userId: newAttempt.userId,
                attemptCount: parseCount(newAttempt.attemptCount),
                lastAttemptAt: newAttempt.lastAttemptAt,
                sentSubjects: newAttempt.sentSubjects || [],
            };
        }
    } catch (error: any) {
        console.error('Error recording interview attempt:', error);
        throw error;
    }
}
