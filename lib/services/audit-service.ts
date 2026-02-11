import { ID, Query, Permission, Role } from 'appwrite';
import { databases } from '@/lib/appwrite';
import { AuditLog, AuditLogAction } from '@/lib/types';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

export interface CreateAuditLogInput {
  action: AuditLogAction;
  actorId: string;
  actorName: string;
  targetId?: string;
  targetType: string;
  metadata?: any;
}

/**
 * Log an action to the audit logs
 */
export async function logAction(input: CreateAuditLogInput): Promise<AuditLog> {
  try {
    const { action, actorId, actorName, targetId, targetType, metadata } = input;

    const doc = await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      ID.unique(),
      {
        action,
        actorId,
        actorName,
        targetId,
        targetType,
        metadata: metadata ? JSON.stringify(metadata) : null,
        performedAt: new Date().toISOString(),
      },
      [
        Permission.read(Role.any()), // We filter in frontend
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ]
    );

    return {
      $id: doc.$id,
      action: doc.action,
      actorId: doc.actorId,
      actorName: doc.actorName,
      targetId: doc.targetId,
      targetType: doc.targetType,
      metadata: doc.metadata,
      performedAt: doc.performedAt,
    };
  } catch (error: any) {
    console.error('Error logging action:', error);
    // Don't throw, just log error so we don't block the main action
    // But we might want to return null or throw if it's critical
    throw error;
  }
}

/**
 * Get audit logs with optional filtering
 */
export async function getAuditLogs(
  filters?: {
    actorId?: string;
    targetType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ logs: AuditLog[]; total: number }> {
  try {
    const queries = [
      Query.orderDesc('performedAt'),
      Query.limit(filters?.limit || 50),
      Query.offset(filters?.offset || 0),
    ];

    if (filters?.actorId) {
      queries.push(Query.equal('actorId', filters.actorId));
    }

    if (filters?.targetType) {
      queries.push(Query.equal('targetType', filters.targetType));
    }

    const response = await databases.listDocuments(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      queries
    );

    const logs = response.documents.map((doc: any) => ({
      $id: doc.$id,
      action: doc.action,
      actorId: doc.actorId,
      actorName: doc.actorName,
      targetId: doc.targetId,
      targetType: doc.targetType,
      metadata: doc.metadata,
      performedAt: doc.performedAt,
    }));

    return {
      logs,
      total: response.total,
    };
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    throw new Error(error.message || 'Failed to fetch audit logs');
  }
}
