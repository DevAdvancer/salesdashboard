/**
 * Schema definitions for the Appwrite collections.
 *
 * This is the single source of truth for the CRM database schema.
 * Both the existing US sync script (sync-appwrite-schema.ts) and the UK
 * migration script (migrate-uk-database.ts) read from this module, so
 * the two databases stay in sync by construction.
 *
 * Source of truth for attribute shapes: docs/APPWRITE_SCHEMA.md
 */

export type SchemaAttr = {
  key: string;
  type: 'string' | 'email' | 'enum' | 'boolean' | 'datetime' | 'integer';
  required?: boolean;
  default?: unknown;
  size?: number;
  array?: boolean;
  values?: string[];
  min?: number;
  max?: number;
};

export type SchemaIndex = {
  key: string;
  type: 'key' | 'unique' | 'fulltext';
  attributes: string[];
};

export type CollectionSchema = {
  attributes: SchemaAttr[];
  indexes: SchemaIndex[];
};

/**
 * All 21 collections. The keys are the collection IDs (must match
 * COLLECTIONS in lib/constants/appwrite.ts) and the values are the
 * attribute and index definitions.
 */
export const collectionSchemas: Record<string, CollectionSchema> = {
  // ─── Users ───────────────────────────────────────────────────────────────
  users: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'email', type: 'email', required: true, size: 255 },
      {
        key: 'role',
        type: 'enum',
        required: true,
        values: [
          'admin',
          'developer',
          'team_lead',
          'agent',
          'lead_generation',
          'monitor',
          'operations',
        ],
        default: 'agent',
      },
      { key: 'teamLeadId', type: 'string', required: false, size: 255 },
      { key: 'branchIds', type: 'string', array: true, required: false, size: 255 },
      { key: 'branchId', type: 'string', required: false, size: 255 },
      { key: 'isActive', type: 'boolean', required: false, default: true },
      {
        key: 'department',
        type: 'enum',
        required: false,
        default: 'sales',
        values: ['sales', 'resume'],
      },
    ],
    indexes: [
      { key: 'email_idx', type: 'unique', attributes: ['email'] },
      { key: 'role_idx', type: 'key', attributes: ['role'] },
      { key: 'team_lead_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchIds'] },
      { key: 'department_idx', type: 'key', attributes: ['department'] },
    ],
  },

  // ─── Leads ───────────────────────────────────────────────────────────────
  leads: {
    attributes: [
      { key: 'data', type: 'string', required: true, size: 65535 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'ownerId', type: 'string', required: true, size: 255 },
      { key: 'assignedToId', type: 'string', required: false, size: 255 },
      { key: 'branchIds', type: 'string', array: true, required: false, size: 255 },
      { key: 'isClosed', type: 'boolean', required: false, default: false },
      { key: 'closedAt', type: 'datetime', required: false },
      { key: 'nextFollowUpAt', type: 'datetime', required: false },
      { key: 'nextAction', type: 'string', required: false, size: 255 },
      { key: 'lastContactedAt', type: 'datetime', required: false },
      { key: 'followUpStatus', type: 'string', required: false, size: 50 },
    ],
    indexes: [
      { key: 'owner_idx', type: 'key', attributes: ['ownerId'] },
      { key: 'assigned_idx', type: 'key', attributes: ['assignedToId'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchIds'] },
      { key: 'closed_status_idx', type: 'key', attributes: ['isClosed', 'status'] },
      { key: 'next_follow_up_idx', type: 'key', attributes: ['nextFollowUpAt'] },
      { key: 'follow_up_status_idx', type: 'key', attributes: ['followUpStatus'] },
    ],
  },

  // ─── Branches ────────────────────────────────────────────────────────────
  branches: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'isActive', type: 'boolean', required: true, default: true },
    ],
    indexes: [
      { key: 'name_idx', type: 'unique', attributes: ['name'] },
      { key: 'active_idx', type: 'key', attributes: ['isActive'] },
    ],
  },

  // ─── Form Config ─────────────────────────────────────────────────────────
  form_config: {
    attributes: [
      { key: 'fields', type: 'string', required: true, size: 65535 },
      { key: 'version', type: 'integer', required: true, min: 0, max: 999999 },
      { key: 'updatedBy', type: 'string', required: true, size: 255 },
    ],
    indexes: [{ key: 'version_idx', type: 'key', attributes: ['version'] }],
  },

  // ─── Access Config ───────────────────────────────────────────────────────
  access_config: {
    attributes: [
      { key: 'componentKey', type: 'string', required: true, size: 50 },
      {
        key: 'role',
        type: 'enum',
        required: true,
        values: ['admin', 'manager', 'agent', 'developer', 'team_lead', 'lead_generation', 'monitor', 'operations'],
      },
      { key: 'allowed', type: 'boolean', required: true, default: false },
    ],
    indexes: [
      { key: 'component_role_idx', type: 'unique', attributes: ['componentKey', 'role'] },
    ],
  },

  // ─── Lead Notes ──────────────────────────────────────────────────────────
  lead_notes: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'authorId', type: 'string', required: true, size: 255 },
      { key: 'authorName', type: 'string', required: true, size: 255 },
      { key: 'body', type: 'string', required: true, size: 10000 },
      { key: 'visibility', type: 'string', required: true, size: 50 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'author_idx', type: 'key', attributes: ['authorId'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
      { key: 'visibility_idx', type: 'key', attributes: ['visibility'] },
    ],
  },

  // ─── Coaching Notes ──────────────────────────────────────────────────────
  coaching_notes: {
    attributes: [
      { key: 'targetUserId', type: 'string', required: true, size: 255 },
      { key: 'targetUserName', type: 'string', required: false, size: 255 },
      { key: 'authorId', type: 'string', required: true, size: 255 },
      { key: 'authorName', type: 'string', required: true, size: 255 },
      { key: 'note', type: 'string', required: true, size: 10000 },
      { key: 'visibility', type: 'string', required: true, size: 50 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'target_user_idx', type: 'key', attributes: ['targetUserId'] },
      { key: 'author_idx', type: 'key', attributes: ['authorId'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
      { key: 'visibility_idx', type: 'key', attributes: ['visibility'] },
    ],
  },

  // ─── Review Queue ────────────────────────────────────────────────────────
  review_queue: {
    attributes: [
      { key: 'type', type: 'string', required: true, size: 100 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'targetId', type: 'string', required: true, size: 255 },
      { key: 'targetType', type: 'string', required: true, size: 100 },
      { key: 'requestedById', type: 'string', required: true, size: 255 },
      { key: 'requestedByName', type: 'string', required: true, size: 255 },
      { key: 'assignedReviewerId', type: 'string', required: false, size: 255 },
      { key: 'reason', type: 'string', required: false, size: 5000 },
      { key: 'metadata', type: 'string', required: false, size: 20000 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'resolvedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'type_idx', type: 'key', attributes: ['type'] },
      { key: 'target_idx', type: 'key', attributes: ['targetId'] },
      { key: 'reviewer_idx', type: 'key', attributes: ['assignedReviewerId'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },

  // ─── Notifications ───────────────────────────────────────────────────────
  notifications: {
    attributes: [
      { key: 'recipientId', type: 'string', required: true, size: 255 },
      { key: 'type', type: 'string', required: true, size: 100 },
      { key: 'title', type: 'string', required: true, size: 255 },
      { key: 'body', type: 'string', required: true, size: 2000 },
      { key: 'targetId', type: 'string', required: false, size: 255 },
      { key: 'targetType', type: 'string', required: false, size: 100 },
      { key: 'readAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'recipient_idx', type: 'key', attributes: ['recipientId'] },
      { key: 'read_idx', type: 'key', attributes: ['readAt'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
      { key: 'type_idx', type: 'key', attributes: ['type'] },
    ],
  },

  // ─── Audit Logs ──────────────────────────────────────────────────────────
  audit_logs: {
    attributes: [
      { key: 'actorId', type: 'string', required: true, size: 255 },
      { key: 'actorName', type: 'string', required: false, size: 255 },
      { key: 'action', type: 'string', required: true, size: 100 },
      { key: 'targetType', type: 'string', required: true, size: 100 },
      { key: 'targetId', type: 'string', required: false, size: 255 },
      { key: 'metadata', type: 'string', required: false, size: 20000 },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'actor_idx', type: 'key', attributes: ['actorId'] },
      { key: 'action_idx', type: 'key', attributes: ['action'] },
      { key: 'target_idx', type: 'key', attributes: ['targetId'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },

  // ─── Attendance ──────────────────────────────────────────────────────────
  attendance: {
    attributes: [
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'userName', type: 'string', required: false, size: 255 },
      { key: 'date', type: 'string', required: true, size: 50 },
      { key: 'clockIn', type: 'datetime', required: false },
      { key: 'clockOut', type: 'datetime', required: false },
      { key: 'status', type: 'string', required: false, size: 50 },
      { key: 'notes', type: 'string', required: false, size: 5000 },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'date_idx', type: 'key', attributes: ['date'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
    ],
  },

  // ─── Chat Messages ───────────────────────────────────────────────────────
  chat_messages: {
    attributes: [
      { key: 'roomId', type: 'string', required: true, size: 255 },
      { key: 'senderId', type: 'string', required: true, size: 255 },
      { key: 'senderName', type: 'string', required: false, size: 255 },
      { key: 'body', type: 'string', required: true, size: 10000 },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'room_idx', type: 'key', attributes: ['roomId'] },
      { key: 'sender_idx', type: 'key', attributes: ['senderId'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },

  // ─── Client Payments ─────────────────────────────────────────────────────
  client_payments: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'personalDetails', type: 'string', required: false, size: 65535, default: '{}' },
      { key: 'paymentPlan', type: 'string', required: true, size: 65535 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'updates', type: 'string', required: false, size: 65535, default: '[]' },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
      { key: 'lastReminderAt', type: 'datetime', required: false },
      { key: 'updatedById', type: 'string', required: false, size: 255 },
      { key: 'updatedByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'leadId_idx', type: 'unique', attributes: ['leadId'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
    ],
  },

  // ─── Lead Requests ───────────────────────────────────────────────────────
  lead_requests: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'email', type: 'email', required: false, size: 255 },
      { key: 'phone', type: 'string', required: false, size: 50 },
      { key: 'message', type: 'string', required: false, size: 10000 },
      { key: 'source', type: 'string', required: false, size: 100 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'assignedToId', type: 'string', required: false, size: 255 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'email_idx', type: 'key', attributes: ['email'] },
      { key: 'source_idx', type: 'key', attributes: ['source'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },

  // ─── Mock Attempts ───────────────────────────────────────────────────────
  mock_attempts: {
    attributes: [
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'userName', type: 'string', required: false, size: 255 },
      { key: 'score', type: 'integer', required: true, min: 0, max: 100 },
      { key: 'totalQuestions', type: 'integer', required: true, min: 0 },
      { key: 'correctAnswers', type: 'integer', required: true, min: 0 },
      { key: 'answers', type: 'string', required: false, size: 65535 },
      { key: 'completedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'completed_idx', type: 'key', attributes: ['completedAt'] },
    ],
  },

  // ─── Assessment Attempts ─────────────────────────────────────────────────
  assessment_attempts: {
    attributes: [
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'userName', type: 'string', required: false, size: 255 },
      { key: 'score', type: 'integer', required: true, min: 0, max: 100 },
      { key: 'totalQuestions', type: 'integer', required: true, min: 0 },
      { key: 'correctAnswers', type: 'integer', required: true, min: 0 },
      { key: 'answers', type: 'string', required: false, size: 65535 },
      { key: 'completedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'completed_idx', type: 'key', attributes: ['completedAt'] },
    ],
  },

  // ─── Interview Attempts ──────────────────────────────────────────────────
  interview_attempts: {
    attributes: [
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'userName', type: 'string', required: false, size: 255 },
      { key: 'score', type: 'integer', required: true, min: 0, max: 100 },
      { key: 'totalQuestions', type: 'integer', required: true, min: 0 },
      { key: 'correctAnswers', type: 'integer', required: true, min: 0 },
      { key: 'answers', type: 'string', required: false, size: 65535 },
      { key: 'feedback', type: 'string', required: false, size: 10000 },
      { key: 'completedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'completed_idx', type: 'key', attributes: ['completedAt'] },
    ],
  },

  // ─── LinkedIn Accounts ───────────────────────────────────────────────────
  linkedin_accounts: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'email', type: 'email', required: false, size: 255 },
      { key: 'profileUrl', type: 'string', required: false, size: 500 },
      { key: 'assignedToId', type: 'string', required: false, size: 255 },
      { key: 'assignedToName', type: 'string', required: false, size: 255 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'isActive', type: 'boolean', required: false, default: true },
      { key: 'lastUsedAt', type: 'datetime', required: false },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'assigned_idx', type: 'key', attributes: ['assignedToId'] },
      { key: 'active_idx', type: 'key', attributes: ['isActive'] },
    ],
  },

  // ─── LinkedIn Requests ───────────────────────────────────────────────────
  linkedin_requests: {
    attributes: [
      { key: 'accountId', type: 'string', required: true, size: 255 },
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'userName', type: 'string', required: false, size: 255 },
      { key: 'targetProfileUrl', type: 'string', required: true, size: 500 },
      { key: 'targetName', type: 'string', required: false, size: 255 },
      { key: 'message', type: 'string', required: false, size: 5000 },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'sentAt', type: 'datetime', required: true },
      { key: 'respondedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'account_idx', type: 'key', attributes: ['accountId'] },
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'sent_idx', type: 'key', attributes: ['sentAt'] },
    ],
  },

  // ─── LG Handoffs ────────────────────────────────────────────────────────
  // Source of truth for the "Lead Gen Team Handoffs" dashboard count.
  // One document per (lead, original Team Lead) pair, written the
  // moment a lead_generation actor hands a lead to a Team Lead. The row
  // is NEVER updated or deleted on later reassignments, so the count
  // grouped by `teamLeadId` is exact: it tracks the original handoff,
  // not the current assignee. `lead_generationId` lets the dashboard
  // build the per-LG breakdown the leadership view already shows.
  lg_handoffs: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'teamLeadId', type: 'string', required: true, size: 255 },
      { key: 'leadGenerationId', type: 'string', required: true, size: 255 },
      { key: 'handedOffAt', type: 'datetime', required: true },
      { key: 'branchId', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_idx', type: 'unique', attributes: ['leadId'] },
      { key: 'team_lead_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'lead_generation_idx', type: 'key', attributes: ['leadGenerationId'] },
      { key: 'handed_off_idx', type: 'key', attributes: ['handedOffAt'] },
    ],
  },
};

/**
 * Returns the list of all collection IDs in this schema set.
 */
export function listCollectionIds(): string[] {
  return Object.keys(collectionSchemas);
}
