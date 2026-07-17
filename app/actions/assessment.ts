'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { assertAuthenticatedUserId, getAuthenticatedAccount } from '@/lib/server/current-user';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const ASSESSMENT_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID || 'assessment_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

type DatabasesClient = Awaited<ReturnType<typeof createAdminClient>>['databases'];

interface UserDocument {
    name?: string;
    role?: string;
}

interface AssessmentAttemptDocument {
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

async function assertCanWriteAssessmentAttempt(databases: DatabasesClient, userId: string) {
    const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId) as unknown as UserDocument;
    if (user.role === 'operations') {
        throw new Error('Permission denied');
    }
    return user;
}

/**
 * Write an ASSESSMENT_EMAIL_SENT audit log entry (best-effort, does not throw).
 */
async function logAssessmentAudit(
  databases: DatabasesClient,
  userId: string,
  leadId: string,
  metadata: Record<string, unknown>
) {
  try {
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

function parseCount(val: unknown): number {
    if (typeof val === 'number') return val;
    const n = parseInt(String(val), 10);
    return isNaN(n) ? 0 : n;
}

function normalizeSubject(subject: string): string {
    return subject.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getSentSubjects(doc: Pick<AssessmentAttemptDocument, 'sentSubjects'>): string[] {
    return Array.isArray(doc.sentSubjects) ? doc.sentSubjects.filter(Boolean) : [];
}

function getGlobalAttemptCount(docs: AssessmentAttemptDocument[]): number {
    return docs.reduce((total, doc) => total + parseCount(doc.attemptCount), 0);
}

function getGlobalSubjects(docs: AssessmentAttemptDocument[]): string[] {
    return docs.flatMap(getSentSubjects);
}

function hasDuplicateSubject(docs: AssessmentAttemptDocument[], subject: string): boolean {
    const normalizedSubject = normalizeSubject(subject);
    return getGlobalSubjects(docs).some((existingSubject) => normalizeSubject(existingSubject) === normalizedSubject);
}

async function listAttemptsForLead(databases: DatabasesClient, leadId: string): Promise<AssessmentAttemptDocument[]> {
    const response = await databases.listDocuments(
        DATABASE_ID,
        ASSESSMENT_ATTEMPTS_COLLECTION_ID,
        [
            Query.equal('leadId', leadId),
            Query.limit(5000),
        ]
    );
    return response.documents as unknown as AssessmentAttemptDocument[];
}

async function createAssessmentAttemptDocument(
    databases: DatabasesClient,
    userId: string,
    leadId: string,
    subject: string,
    documentId: string
): Promise<AssessmentAttemptDocument> {
    return databases.createDocument(
        DATABASE_ID,
        ASSESSMENT_ATTEMPTS_COLLECTION_ID,
        documentId,
        {
            leadId,
            userId,
            attemptCount: 1,
            lastAttemptAt: new Date().toISOString(),
            sentSubjects: [subject],
        }
    ) as unknown as AssessmentAttemptDocument;
}

/**
 * Get all assessment attempts for a user and a set of lead IDs.
 * Appwrite Query.equal() arrays are capped at 100 items, so we batch automatically.
 */
export async function getAssessmentAttempts(userId: string, leadIds: string[]) {
    await assertAuthenticatedUserId(userId);
    if (!leadIds.length) return [];

    try {
        const { databases } = await createAdminClient();

        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < leadIds.length; i += CHUNK) {
            chunks.push(leadIds.slice(i, i + CHUNK));
        }

        const batchResults = await Promise.all(
            chunks.map((chunk) =>
                databases.listDocuments(
                    DATABASE_ID,
                    ASSESSMENT_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(5000),
                    ]
                )
            )
        );

        const mergedMap = new Map<string, { $id: string; leadId: string; userId: string; attemptCount: number; lastAttemptAt: string; sentSubjects: string[] }>();
        const documents = batchResults.flatMap((res) => res.documents as unknown as AssessmentAttemptDocument[]);
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
        console.error('Error getting assessment attempts:', error);
        return [];
    }
}

/**
 * Count assessment-support emails SENT within an inclusive ISO date range,
 * scoped to a set of visible lead IDs. Counts each attempt document whose
 * send timestamp (`lastAttemptAt`) falls inside [dateFromIso, dateToIso] so
 * the dashboard reflects "emails sent in this period" regardless of when the
 * underlying lead was created.
 */
export async function countAssessmentEmailsSentInRange(
    userId: string,
    leadIds: string[],
    dateFromIso: string,
    dateToIso: string,
): Promise<number> {
    await assertAuthenticatedUserId(userId);
    if (!leadIds.length || !dateFromIso || !dateToIso) return 0;

    try {
        const { databases } = await createAdminClient();

        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < leadIds.length; i += CHUNK) {
            chunks.push(leadIds.slice(i, i + CHUNK));
        }

        const batchResults = await Promise.all(
            chunks.map((chunk) =>
                databases.listDocuments(
                    DATABASE_ID,
                    ASSESSMENT_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(5000),
                    ]
                )
            )
        );

        const documents = batchResults.flatMap((res) => res.documents as unknown as AssessmentAttemptDocument[]);
        return documents.reduce((total, doc) => {
            const sentAt = doc.lastAttemptAt;
            if (!sentAt || sentAt < dateFromIso || sentAt > dateToIso) return total;
            return total + parseCount(doc.attemptCount);
        }, 0);
    } catch (error: unknown) {
        console.error('Error counting assessment emails sent in range:', error);
        return 0;
    }
}

/**
 * Check if a subject has already been sent for a particular lead by any user.
 * Returns true if the subject is a duplicate.
 */
export async function checkDuplicateSubject(leadId: string, subject: string): Promise<boolean> {
    if (!leadId || !subject) return false;

    try {
        await getAuthenticatedAccount();
        const { databases } = await createAdminClient();
        const documents = await listAttemptsForLead(databases, leadId);
        return hasDuplicateSubject(documents, subject);
    } catch (error: unknown) {
        console.error('Error checking duplicate subject:', error);
        return false;
    }
}

/**
 * Reserve a new assessment attempt before sending email.
 */
export async function reserveAssessmentAttempt(userId: string, leadId: string, subject: string) {
    if (!userId || !leadId || !subject?.trim()) throw new Error('Invalid input');
    await assertAuthenticatedUserId(userId);

    try {
        const { databases } = await createAdminClient();
        const user = await assertCanWriteAssessmentAttempt(databases, userId);
        const isAdmin = user.role === 'admin' || user.role === 'developer';
        const allAttempts = await listAttemptsForLead(databases, leadId);

        if (isAdmin) {
            const newAttempt = await createAssessmentAttemptDocument(databases, userId, leadId, subject, ID.unique());
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

        if (hasDuplicateSubject(allAttempts, subject)) {
            throw new Error('An assessment with this exact subject has already been sent for this candidate. Please change the details to avoid a duplicate.');
        }

        const globalAttemptCount = getGlobalAttemptCount(allAttempts);
        const newAttempt = await createAssessmentAttemptDocument(
            databases,
            userId,
            leadId,
            subject,
            ID.unique()
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
        console.error('Error reserving assessment attempt:', error);
        throw error;
    }
}

/**
 * Roll back a reserved assessment attempt if the Graph send fails.
 */
export async function rollbackAssessmentAttempt(userId: string, reservation: AttemptReservation | null | undefined) {
    await assertAuthenticatedUserId(userId);
    if (!reservation?.documentId) return;

    try {
        const { databases } = await createAdminClient();
        await assertCanWriteAssessmentAttempt(databases, userId);

        if (reservation.created) {
            await databases.deleteDocument(
                DATABASE_ID,
                ASSESSMENT_ATTEMPTS_COLLECTION_ID,
                reservation.documentId
            );
            return;
        }

        await databases.updateDocument(
            DATABASE_ID,
            ASSESSMENT_ATTEMPTS_COLLECTION_ID,
            reservation.documentId,
            {
                attemptCount: reservation.previousAttemptCount ?? 0,
                lastAttemptAt: reservation.previousLastAttemptAt,
                sentSubjects: reservation.previousSentSubjects || [],
            }
        );
    } catch (error: unknown) {
        console.error('Error rolling back assessment attempt:', error);
    }
}

/**
 * Write the audit log after the email has been accepted by Graph.
 */
export async function completeAssessmentAttempt(
    userId: string,
    leadId: string,
    subject: string,
    attemptCount: number,
    auditMetadata?: Record<string, unknown>
) {
    await assertAuthenticatedUserId(userId);
    const { databases } = await createAdminClient();
    await assertCanWriteAssessmentAttempt(databases, userId);

    await logAssessmentAudit(databases, userId, leadId, {
        subject,
        attemptCount,
        ...(auditMetadata || {}),
    });
}

/**
 * Backwards-compatible helper for callers that record after sending.
 */
export async function recordAssessmentAttempt(userId: string, leadId: string, subject: string, auditMetadata?: Record<string, unknown>) {
    await assertAuthenticatedUserId(userId);
    const attempt = await reserveAssessmentAttempt(userId, leadId, subject);
    await completeAssessmentAttempt(userId, leadId, subject, attempt.attemptCount, auditMetadata);
    return attempt;
}
