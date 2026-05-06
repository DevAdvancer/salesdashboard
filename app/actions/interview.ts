'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { createHash } from 'crypto';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const INTERVIEW_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_INTERVIEW_ATTEMPTS_COLLECTION_ID || 'interview_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;
const MAX_SUPPORT_ATTEMPTS = 2;

type DatabasesClient = Awaited<ReturnType<typeof createAdminClient>>['databases'];

interface UserDocument {
    name?: string;
    role?: string;
}

interface InterviewAttemptDocument {
    $id: string;
    leadId: string;
    userId: string;
    attemptCount?: number | string;
    lastAttemptAt: string;
    sentSubjects?: string[];
}

interface AttemptReservation {
    documentId: string;
    created: boolean;
    subject: string;
    previousAttemptCount: number;
    previousLastAttemptAt: string | null;
    previousSentSubjects: string[];
}

/**
 * Write an INTERVIEW_EMAIL_SENT audit log entry (best-effort, does not throw).
 */
async function logInterviewAudit(
  databases: DatabasesClient,
  userId: string,
  leadId: string,
  metadata: Record<string, unknown>
) {
  try {
    // Fetch user name
    let actorName = userId;
    try {
      const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId) as unknown as UserDocument;
      actorName = user.name || userId;
    } catch {}

    await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      ID.unique(),
      {
        action: 'INTERVIEW_EMAIL_SENT',
        actorId: userId,
        actorName,
        targetId: leadId,
        targetType: 'INTERVIEW',
        metadata: JSON.stringify(metadata),
        performedAt: new Date().toISOString(),
      }
    );
  } catch (e) {
    console.error('[audit] Failed to log INTERVIEW_EMAIL_SENT:', e);
  }
}

// Helper: parse attemptCount safely whether stored as string or integer
function parseCount(val: unknown): number {
    if (typeof val === 'number') return val;
    const n = parseInt(String(val), 10);
    return isNaN(n) ? 0 : n;
}

function normalizeSubject(subject: string): string {
    return subject.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getSentSubjects(doc: Pick<InterviewAttemptDocument, 'sentSubjects'>): string[] {
    return Array.isArray(doc.sentSubjects) ? doc.sentSubjects.filter(Boolean) : [];
}

function getGlobalAttemptCount(docs: InterviewAttemptDocument[]): number {
    return docs.reduce((total, doc) => total + parseCount(doc.attemptCount), 0);
}

function getGlobalSubjects(docs: InterviewAttemptDocument[]): string[] {
    return docs.flatMap(getSentSubjects);
}

function hasDuplicateSubject(docs: InterviewAttemptDocument[], subject: string): boolean {
    const normalizedSubject = normalizeSubject(subject);
    return getGlobalSubjects(docs).some((existingSubject) => normalizeSubject(existingSubject) === normalizedSubject);
}

async function listAttemptsForLead(databases: DatabasesClient, leadId: string): Promise<InterviewAttemptDocument[]> {
    const response = await databases.listDocuments(
        DATABASE_ID,
        INTERVIEW_ATTEMPTS_COLLECTION_ID,
        [
            Query.equal('leadId', leadId),
            Query.limit(5000),
        ]
    );
    return response.documents as unknown as InterviewAttemptDocument[];
}

function getAttemptSlotDocumentId(leadId: string, slot: number): string {
    const hash = createHash('sha1').update(`interview:${leadId}:${slot}`).digest('hex').slice(0, 30);
    return `i_${hash}`;
}

function isConflictError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 409;
}

async function createInterviewAttemptDocument(
    databases: DatabasesClient,
    userId: string,
    leadId: string,
    subject: string,
    documentId: string
): Promise<InterviewAttemptDocument> {
    return databases.createDocument(
        DATABASE_ID,
        INTERVIEW_ATTEMPTS_COLLECTION_ID,
        documentId,
        {
            leadId,
            userId,
            attemptCount: '1',
            lastAttemptAt: new Date().toISOString(),
            sentSubjects: [subject],
        }
    ) as unknown as InterviewAttemptDocument;
}

/**
 * Get all interview attempts for a user and a set of lead IDs
 */
export async function getInterviewAttempts(userId: string, leadIds: string[]) {
    if (!leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < leadIds.length; i += CHUNK) {
            chunks.push(leadIds.slice(i, i + CHUNK));
        }

        // NOTE: We query by leadId only (no userId filter) so that attempts created
        // by ANY user are visible to everyone who can see that lead.
        const batchResults = await Promise.all(
            chunks.map((chunk) =>
                databases.listDocuments(
                    DATABASE_ID,
                    INTERVIEW_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(5000),
                    ]
                )
            )
        );

        // Merge: if multiple users have attempts for the same lead, combine them
        const mergedMap = new Map<string, { $id: string; leadId: string; userId: string; attemptCount: number; lastAttemptAt: string; sentSubjects: string[] }>();
        const documents = batchResults.flatMap((res) => res.documents as unknown as InterviewAttemptDocument[]);
        documents.forEach((doc) => {
            const existing = mergedMap.get(doc.leadId);
            const count = parseCount(doc.attemptCount);
            if (!existing) {
                mergedMap.set(doc.leadId, {
                    $id: doc.$id,
                    leadId: doc.leadId,
                    userId: doc.userId,
                    attemptCount: count,
                    lastAttemptAt: doc.lastAttemptAt,
                    sentSubjects: doc.sentSubjects || [],
                });
            } else {
                existing.attemptCount += count;
                if (doc.lastAttemptAt > existing.lastAttemptAt) {
                    existing.lastAttemptAt = doc.lastAttemptAt;
                }
                existing.sentSubjects = [...existing.sentSubjects, ...(doc.sentSubjects || [])];
            }
        });

        return Array.from(mergedMap.values());
    } catch (error: unknown) {
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

        const documents = await listAttemptsForLead(databases, leadId);
        return hasDuplicateSubject(documents, subject);
    } catch (error: unknown) {
        console.error('Error checking duplicate interview subject:', error);
        return false;
    }
}

/**
 * Reserve a new interview attempt before sending email.
 * attemptCount is stored as a string to match Appwrite String attribute type.
 */
export async function reserveInterviewAttempt(userId: string, leadId: string, subject: string) {
    if (!userId || !leadId || !subject?.trim()) throw new Error('Invalid input');

    try {
        const { databases } = await createAdminClient();
        const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId) as unknown as UserDocument;
        const isAdmin = user.role === 'admin';

        let allAttempts = await listAttemptsForLead(databases, leadId);

        if (isAdmin) {
            const newAttempt = await createInterviewAttemptDocument(databases, userId, leadId, subject, ID.unique());
            return {
                $id: newAttempt.$id,
                leadId: newAttempt.leadId,
                userId: newAttempt.userId,
                attemptCount: getGlobalAttemptCount(allAttempts) + 1,
                lastAttemptAt: newAttempt.lastAttemptAt,
                sentSubjects: [...getGlobalSubjects(allAttempts), subject],
                reservation: {
                    documentId: newAttempt.$id,
                    created: true,
                    subject,
                    previousAttemptCount: 0,
                    previousLastAttemptAt: null,
                    previousSentSubjects: [],
                },
            };
        }

        for (let slot = 1; slot <= MAX_SUPPORT_ATTEMPTS; slot += 1) {
            const globalAttemptCount = getGlobalAttemptCount(allAttempts);

            if (hasDuplicateSubject(allAttempts, subject)) {
                throw new Error('An interview with this exact subject has already been sent for this candidate. Please change the details to avoid a duplicate.');
            }

            if (globalAttemptCount >= MAX_SUPPORT_ATTEMPTS) {
                throw new Error('Maximum of 2 interview support emails reached for this candidate.');
            }

            try {
                const newAttempt = await createInterviewAttemptDocument(
                    databases,
                    userId,
                    leadId,
                    subject,
                    getAttemptSlotDocumentId(leadId, slot)
                );

                return {
                    $id: newAttempt.$id,
                    leadId: newAttempt.leadId,
                    userId: newAttempt.userId,
                    attemptCount: globalAttemptCount + 1,
                    lastAttemptAt: newAttempt.lastAttemptAt,
                    sentSubjects: [...getGlobalSubjects(allAttempts), subject],
                    reservation: {
                        documentId: newAttempt.$id,
                        created: true,
                        subject,
                        previousAttemptCount: 0,
                        previousLastAttemptAt: null,
                        previousSentSubjects: [],
                    },
                };
            } catch (error: unknown) {
                if (!isConflictError(error)) {
                    throw error;
                }

                allAttempts = await listAttemptsForLead(databases, leadId);
            }
        }

        throw new Error('Maximum of 2 interview support emails reached for this candidate.');
    } catch (error: unknown) {
        console.error('Error reserving interview attempt:', error);
        throw error;
    }
}

/**
 * Roll back a reserved interview attempt if the Graph send fails.
 */
export async function rollbackInterviewAttempt(reservation: AttemptReservation | null | undefined) {
    if (!reservation?.documentId) return;

    try {
        const { databases } = await createAdminClient();

        if (reservation.created) {
            await databases.deleteDocument(
                DATABASE_ID,
                INTERVIEW_ATTEMPTS_COLLECTION_ID,
                reservation.documentId
            );
            return;
        }

        await databases.updateDocument(
            DATABASE_ID,
            INTERVIEW_ATTEMPTS_COLLECTION_ID,
            reservation.documentId,
            {
                attemptCount: String(reservation.previousAttemptCount ?? 0),
                lastAttemptAt: reservation.previousLastAttemptAt,
                sentSubjects: reservation.previousSentSubjects || [],
            }
        );
    } catch (error: unknown) {
        console.error('Error rolling back interview attempt:', error);
    }
}

/**
 * Write the audit log after the email has been accepted by Graph.
 */
export async function completeInterviewAttempt(
    userId: string,
    leadId: string,
    subject: string,
    attemptCount: number,
    auditMetadata?: Record<string, unknown>
) {
    const { databases } = await createAdminClient();

    await logInterviewAudit(databases, userId, leadId, {
        subject,
        attemptCount,
        ...(auditMetadata || {}),
    });
}

/**
 * Backwards-compatible helper for callers that record after sending.
 */
export async function recordInterviewAttempt(userId: string, leadId: string, subject: string, auditMetadata?: Record<string, unknown>) {
    const attempt = await reserveInterviewAttempt(userId, leadId, subject);
    await completeInterviewAttempt(userId, leadId, subject, attempt.attemptCount, auditMetadata);
    return attempt;
}
