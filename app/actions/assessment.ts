'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ASSESSMENT_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID || 'assessment_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

/**
 * Write an ASSESSMENT_EMAIL_SENT audit log entry (best-effort, does not throw).
 */
async function logAssessmentAudit(
  databases: any,
  userId: string,
  leadId: string,
  metadata: Record<string, any>
) {
  try {
    let actorName = userId;
    try {
      const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId);
      actorName = user.name || userId;
    } catch {}

    await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      ID.unique(),
      {
        action: 'ASSESSMENT_EMAIL_SENT',
        actorId: userId,
        actorName,
        targetId: leadId,
        targetType: 'ASSESSMENT',
        metadata: JSON.stringify(metadata),
        performedAt: new Date().toISOString(),
      }
    );
  } catch (e) {
    console.error('[audit] Failed to log ASSESSMENT_EMAIL_SENT:', e);
  }
}

/**
 * Get all assessment attempts for a user and a set of lead IDs.
 * Appwrite Query.equal() arrays are capped at 100 items — we batch automatically.
 */
export async function getAssessmentAttempts(userId: string, leadIds: string[]) {
    if (!leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        // Chunk into batches of 100 (Appwrite hard limit)
        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < leadIds.length; i += CHUNK) {
            chunks.push(leadIds.slice(i, i + CHUNK));
        }

        // Run all batches in parallel
        // NOTE: We query by leadId only (no userId filter) so that attempts created
        // by ANY user are visible to everyone who can see that lead.
        const batchResults = await Promise.all(
            chunks.map((chunk) =>
                databases.listDocuments(
                    DATABASE_ID,
                    ASSESSMENT_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(chunk.length),
                    ]
                )
            )
        );

        // Merge: if multiple users have attempts for the same lead, combine them
        const mergedMap = new Map<string, { $id: string; leadId: string; userId: string; attemptCount: number; lastAttemptAt: string; sentSubjects: string[] }>();
        batchResults.flatMap((res) => res.documents).forEach((doc: any) => {
            const existing = mergedMap.get(doc.leadId);
            if (!existing) {
                mergedMap.set(doc.leadId, {
                    $id: doc.$id,
                    leadId: doc.leadId,
                    userId: doc.userId,
                    attemptCount: doc.attemptCount,
                    lastAttemptAt: doc.lastAttemptAt,
                    sentSubjects: doc.sentSubjects || [],
                });
            } else {
                existing.attemptCount += doc.attemptCount;
                if (doc.lastAttemptAt > existing.lastAttemptAt) {
                    existing.lastAttemptAt = doc.lastAttemptAt;
                }
                existing.sentSubjects = [...existing.sentSubjects, ...(doc.sentSubjects || [])];
            }
        });

        return Array.from(mergedMap.values());
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
export async function recordAssessmentAttempt(userId: string, leadId: string, subject: string, auditMetadata?: Record<string, any>) {
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

            // Audit log
            await logAssessmentAudit(databases, userId, leadId, {
                subject,
                attemptCount: attempt.attemptCount + 1,
                ...(auditMetadata || {}),
            });

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

            // Audit log
            await logAssessmentAudit(databases, userId, leadId, {
                subject,
                attemptCount: 1,
                ...(auditMetadata || {}),
            });

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
