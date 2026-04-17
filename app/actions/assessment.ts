'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ASSESSMENT_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID || 'assessment_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';

/**
 * Get all assessment attempts for a user and a set of lead IDs
 */
export async function getAssessmentAttempts(userId: string, leadIds: string[]) {
    if (!userId || !leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        const response = await databases.listDocuments(
            DATABASE_ID,
            ASSESSMENT_ATTEMPTS_COLLECTION_ID,
            [
                Query.equal('userId', userId),
                Query.equal('leadId', leadIds)
            ]
        );

        return response.documents.map((doc: any) => ({
            $id: doc.$id,
            leadId: doc.leadId,
            userId: doc.userId,
            attemptCount: doc.attemptCount,
            lastAttemptAt: doc.lastAttemptAt,
            sentSubjects: doc.sentSubjects || [],
        }));
    } catch (error: any) {
        console.error('Error getting assessment attempts:', error);
        return [];
    }
}

/**
 * Check if a subject has already been sent for a particular lead by any user.
 * Returns true if the subject is a duplicate.
 */
export async function checkDuplicateSubject(leadId: string, subject: string): Promise<boolean> {
    if (!leadId || !subject) return false;

    try {
        const { databases } = await createAdminClient();

        // Get ALL assessment attempts for this lead (across all users)
        const response = await databases.listDocuments(
            DATABASE_ID,
            ASSESSMENT_ATTEMPTS_COLLECTION_ID,
            [
                Query.equal('leadId', leadId),
            ]
        );

        // Check if the exact subject already exists in any attempt
        for (const doc of response.documents) {
            const sentSubjects: string[] = doc.sentSubjects || [];
            if (sentSubjects.includes(subject)) {
                return true; // Duplicate found
            }
        }

        return false;
    } catch (error: any) {
        console.error('Error checking duplicate subject:', error);
        return false;
    }
}

/**
 * Record a new assessment attempt or update an existing one.
 * Multiple assessments are allowed per lead, but duplicate subjects are blocked.
 * The subject of each sent email is stored to prevent duplicates.
 */
export async function recordAssessmentAttempt(userId: string, leadId: string, subject: string) {
    if (!userId || !leadId) throw new Error('Invalid input');

    try {
        const { databases } = await createAdminClient();
        const collectionId = ASSESSMENT_ATTEMPTS_COLLECTION_ID;

        // First, check for duplicate subject across ALL users for this lead
        const isDuplicate = await checkDuplicateSubject(leadId, subject);
        if (isDuplicate) {
            throw new Error('An assessment with this exact subject has already been sent for this candidate. Please change the details to avoid a duplicate.');
        }

        // Check for existing attempt record for this user + lead
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

            // Update attempt — increment count and append subject
            const updated = await databases.updateDocument(
                DATABASE_ID,
                collectionId,
                attempt.$id,
                {
                    attemptCount: attempt.attemptCount + 1,
                    lastAttemptAt: now,
                    sentSubjects: [...existingSubjects, subject],
                }
            );

            return {
                $id: updated.$id,
                leadId: updated.leadId,
                userId: updated.userId,
                attemptCount: updated.attemptCount,
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
                    attemptCount: 1,
                    lastAttemptAt: now,
                    sentSubjects: [subject],
                }
            );

            return {
                $id: newAttempt.$id,
                leadId: newAttempt.leadId,
                userId: newAttempt.userId,
                attemptCount: newAttempt.attemptCount,
                lastAttemptAt: newAttempt.lastAttemptAt,
                sentSubjects: newAttempt.sentSubjects || [],
            };
        }
    } catch (error: any) {
        console.error('Error recording assessment attempt:', error);
        throw error;
    }
}
