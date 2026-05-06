'use server';

import { ID, Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { createHash } from 'crypto';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const MOCK_ATTEMPTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID || 'mock_attempts';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;
const MAX_MOCK_ATTEMPTS = 2;
const COOLDOWN_MINUTES = 30;

type DatabasesClient = Awaited<ReturnType<typeof createAdminClient>>['databases'];

interface UserDocument {
    name?: string;
    role?: string;
}

interface MockAttemptDocument {
    $id: string;
    leadId: string;
    userId: string;
    attemptCount?: number | string;
    lastAttemptAt: string;
}

interface AttemptReservation {
    documentId: string;
    created: boolean;
    previousAttemptCount: number;
    previousLastAttemptAt: string | null;
}

function parseCount(val: unknown): number {
    if (typeof val === 'number') return val;
    const n = parseInt(String(val), 10);
    return isNaN(n) ? 0 : n;
}

function getLatestAttemptAt(docs: MockAttemptDocument[]): string | null {
    return docs.reduce<string | null>((latest, doc) => {
        if (!doc.lastAttemptAt) return latest;
        return !latest || doc.lastAttemptAt > latest ? doc.lastAttemptAt : latest;
    }, null);
}

function getGlobalAttemptCount(docs: MockAttemptDocument[]): number {
    return docs.reduce((total, doc) => total + parseCount(doc.attemptCount), 0);
}

async function listAttemptsForLead(databases: DatabasesClient, leadId: string): Promise<MockAttemptDocument[]> {
    const response = await databases.listDocuments(
        DATABASE_ID,
        MOCK_ATTEMPTS_COLLECTION_ID,
        [
            Query.equal('leadId', leadId),
            Query.limit(5000),
        ]
    );
    return response.documents as unknown as MockAttemptDocument[];
}

function getAttemptSlotDocumentId(leadId: string, slot: number): string {
    const hash = createHash('sha1').update(`mock:${leadId}:${slot}`).digest('hex').slice(0, 30);
    return `m_${hash}`;
}

function isConflictError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 409;
}

async function createMockAttemptDocument(
    databases: DatabasesClient,
    userId: string,
    leadId: string,
    documentId: string
): Promise<MockAttemptDocument> {
    return databases.createDocument(
        DATABASE_ID,
        MOCK_ATTEMPTS_COLLECTION_ID,
        documentId,
        {
            leadId,
            userId,
            attemptCount: 1,
            lastAttemptAt: new Date().toISOString(),
        }
    ) as unknown as MockAttemptDocument;
}

/**
 * Write a MOCK_EMAIL_SENT audit log entry (best-effort, does not throw).
 */
async function logMockAudit(
  databases: DatabasesClient,
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
 * Appwrite Query.equal() arrays are capped at 100 items, so we batch automatically.
 */
export async function getMockAttempts(userId: string, leadIds: string[]) {
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
                    MOCK_ATTEMPTS_COLLECTION_ID,
                    [
                        Query.equal('leadId', chunk),
                        Query.limit(5000),
                    ]
                )
            )
        );

        const mergedMap = new Map<string, { $id: string; leadId: string; userId: string; attemptCount: number; lastAttemptAt: string }>();
        const documents = batchResults.flatMap((res) => res.documents as unknown as MockAttemptDocument[]);
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
                });
            } else {
                existing.attemptCount += count;
                if (doc.lastAttemptAt > existing.lastAttemptAt) {
                    existing.lastAttemptAt = doc.lastAttemptAt;
                }
                if (doc.userId === userId) {
                    existing.$id = doc.$id;
                    existing.userId = doc.userId;
                }
            }
        });

        return Array.from(mergedMap.values());
    } catch (error: unknown) {
        console.error('Error getting mock attempts:', error);
        return [];
    }
}

/**
 * Reserve a new mock attempt before sending email.
 */
export async function reserveMockAttempt(userId: string, leadId: string) {
    if (!userId || !leadId) throw new Error('Invalid input');

    try {
        const { databases } = await createAdminClient();
        const user = await databases.getDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId
        ) as unknown as UserDocument;
        const isAdmin = user.role === 'admin';
        let allAttempts = await listAttemptsForLead(databases, leadId);

        if (isAdmin) {
            const newAttempt = await createMockAttemptDocument(databases, userId, leadId, ID.unique());
            return {
                $id: newAttempt.$id,
                leadId: newAttempt.leadId,
                userId: newAttempt.userId,
                attemptCount: getGlobalAttemptCount(allAttempts) + 1,
                lastAttemptAt: newAttempt.lastAttemptAt,
                userName: user.name || userId,
                reservation: {
                    documentId: newAttempt.$id,
                    created: true,
                    previousAttemptCount: 0,
                    previousLastAttemptAt: null,
                },
            };
        }

        for (let slot = 1; slot <= MAX_MOCK_ATTEMPTS; slot += 1) {
            const globalAttemptCount = getGlobalAttemptCount(allAttempts);
            const latestAttemptAt = getLatestAttemptAt(allAttempts);

            if (globalAttemptCount >= MAX_MOCK_ATTEMPTS) {
                throw new Error('Maximum attempts reached');
            }

            if (latestAttemptAt) {
                const diffMs = Date.now() - new Date(latestAttemptAt).getTime();
                const diffMinutes = diffMs / (1000 * 60);

                if (diffMinutes < COOLDOWN_MINUTES) {
                    throw new Error('Cooldown period active');
                }
            }

            try {
                const newAttempt = await createMockAttemptDocument(
                    databases,
                    userId,
                    leadId,
                    getAttemptSlotDocumentId(leadId, slot)
                );

                return {
                    $id: newAttempt.$id,
                    leadId: newAttempt.leadId,
                    userId: newAttempt.userId,
                    attemptCount: globalAttemptCount + 1,
                    lastAttemptAt: newAttempt.lastAttemptAt,
                    userName: user.name || userId,
                    reservation: {
                        documentId: newAttempt.$id,
                        created: true,
                        previousAttemptCount: 0,
                        previousLastAttemptAt: null,
                    },
                };
            } catch (error: unknown) {
                if (!isConflictError(error)) {
                    throw error;
                }

                allAttempts = await listAttemptsForLead(databases, leadId);
            }
        }

        throw new Error('Maximum attempts reached');
    } catch (error: unknown) {
        console.error('Error reserving mock attempt:', error);
        throw error;
    }
}

/**
 * Roll back a reserved mock attempt if the Graph send fails.
 */
export async function rollbackMockAttempt(reservation: AttemptReservation | null | undefined) {
    if (!reservation?.documentId) return;

    try {
        const { databases } = await createAdminClient();

        if (reservation.created) {
            await databases.deleteDocument(
                DATABASE_ID,
                MOCK_ATTEMPTS_COLLECTION_ID,
                reservation.documentId
            );
            return;
        }

        await databases.updateDocument(
            DATABASE_ID,
            MOCK_ATTEMPTS_COLLECTION_ID,
            reservation.documentId,
            {
                attemptCount: reservation.previousAttemptCount ?? 0,
                lastAttemptAt: reservation.previousLastAttemptAt,
            }
        );
    } catch (error: unknown) {
        console.error('Error rolling back mock attempt:', error);
    }
}

/**
 * Write the audit log after the email has been accepted by Graph.
 */
export async function completeMockAttempt(
    userId: string,
    leadId: string,
    candidateName: string,
    attemptCount: number,
    userName?: string
) {
    const { databases } = await createAdminClient();
    let actorName = userName || userId;

    if (!userName) {
        try {
            const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId) as unknown as UserDocument;
            actorName = user.name || userId;
        } catch {}
    }

    await logMockAudit(
        databases,
        userId,
        actorName,
        leadId,
        candidateName,
        attemptCount
    );
}

/**
 * Backwards-compatible helper for callers that record after sending.
 */
export async function recordMockAttempt(userId: string, leadId: string, candidateName: string = '') {
    const attempt = await reserveMockAttempt(userId, leadId);
    await completeMockAttempt(userId, leadId, candidateName, attempt.attemptCount, attempt.userName);
    return attempt;
}
