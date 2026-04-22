'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
// import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite'; // Server-side imports only

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const MOCK_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID || 'mock_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

/**
 * Write a MOCK_EMAIL_SENT audit log entry (best-effort, does not throw).
 */
async function logMockAudit(
  databases: any,
  userId: string,
  userName: string,
  leadId: string,
  candidateName: string,
  attemptCount: number
) {
  try {
    await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      ID.unique(),
      {
        action: 'MOCK_EMAIL_SENT',
        actorId: userId,
        actorName: userName,
        targetId: leadId,
        targetType: 'MOCK',
        metadata: JSON.stringify({
          candidateName,
          leadId,
          attemptCount,
        }),
        performedAt: new Date().toISOString(),
      }
    );
  } catch (e) {
    console.error('[audit] Failed to log MOCK_EMAIL_SENT:', e);
  }
}

/**
 * Get all mock attempts for a user and a set of lead IDs.
 * Appwrite Query.equal() arrays are capped at 100 items — we batch automatically.
 */
export async function getMockAttempts(userId: string, leadIds: string[]) {
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
                    MOCK_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(chunk.length),
                    ]
                )
            )
        );

        // Merge: if multiple users have attempts for the same lead, sum them up
        // so the badge reflects the total across all users.
        const mergedMap = new Map<string, { $id: string; leadId: string; userId: string; attemptCount: number; lastAttemptAt: string }>();
        batchResults.flatMap((res) => res.documents).forEach((doc: any) => {
            const existing = mergedMap.get(doc.leadId);
            if (!existing) {
                mergedMap.set(doc.leadId, {
                    $id: doc.$id,
                    leadId: doc.leadId,
                    userId: doc.userId,
                    attemptCount: doc.attemptCount,
                    lastAttemptAt: doc.lastAttemptAt,
                });
            } else {
                // Sum counts and keep the latest timestamp
                existing.attemptCount += doc.attemptCount;
                if (doc.lastAttemptAt > existing.lastAttemptAt) {
                    existing.lastAttemptAt = doc.lastAttemptAt;
                }
                // Use this user's record if it's the current user (for cooldown checks)
                if (doc.userId === userId) {
                    existing.$id = doc.$id;
                    existing.userId = doc.userId;
                }
            }
        });

        return Array.from(mergedMap.values());
    } catch (error: any) {
        console.error('Error getting mock attempts:', error);
        return [];
    }
}

/**
 * Record a new mock attempt or update an existing one
 */
export async function recordMockAttempt(userId: string, leadId: string, candidateName: string = '') {
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

            // Audit log
            await logMockAudit(
                databases,
                userId,
                user.name || userId,
                leadId,
                candidateName,
                updated.attemptCount
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

            // Audit log
            await logMockAudit(
                databases,
                userId,
                user.name || userId,
                leadId,
                candidateName,
                1
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
