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

  // ─── Not Interested Leads ─────────────────────────────────────────────────
  // Source of truth for the "Not Interested" column in the weekly
  // report. One document per marking event — a lead can accumulate
  // multiple rows across its lifetime when an agent retries it and
  // marks it not-interested again. `status` flips from "active" to
  // "reopened" when the lead is re-marked or explicitly reopened;
  // reports count only `status: "active"` rows in the selected range
  // and attribute them to `previousOwnerId` (the agent whose lead it
  // was). NOT unique on `leadId` — by design, because each retry
  // cycle produces a new event row.
  not_interested_leads: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'markedById', type: 'string', required: true, size: 255 },
      { key: 'markedByName', type: 'string', required: true, size: 255 },
      { key: 'markedAt', type: 'datetime', required: true },
      { key: 'previousOwnerId', type: 'string', required: true, size: 255 },
      { key: 'previousAssignedToId', type: 'string', required: false, size: 255 },
      { key: 'branchId', type: 'string', required: false, size: 255 },
      { key: 'reason', type: 'string', required: false, size: 500 },
      {
        key: 'status',
        type: 'enum',
        required: true,
        default: 'active',
        values: ['active', 'reopened'],
      },
      { key: 'reopenedAt', type: 'datetime', required: false },
      { key: 'reopenedById', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'marked_by_idx', type: 'key', attributes: ['markedById'] },
      { key: 'marked_at_idx', type: 'key', attributes: ['markedAt'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'previous_owner_idx', type: 'key', attributes: ['previousOwnerId'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchId'] },
    ],
  },

  // ─── Monthly Targets ─────────────────────────────────────────────────────
  // One document per (team_lead_id, month_key) where month_key is
  // "YYYY-MM". Carries the total team target set by an admin for the
  // month. The amount entered here is the denominator in the
  // "achievement" calculation — money collected (from client_payments)
  // is divided by this number to compute a percentage. TLs then split
  // this total across their agents via `monthly_target_assignments`.
  monthly_targets: {
    attributes: [
      { key: 'teamLeadId', type: 'string', required: true, size: 255 },
      { key: 'teamLeadName', type: 'string', required: false, size: 255 },
      // YYYY-MM string so range queries and uniqueness are simple.
      { key: 'monthKey', type: 'string', required: true, size: 7 },
      // The total amount the admin set as this team's target for the
      // month — the upfront side of the achievement calculation.
      { key: 'totalAmount', type: 'integer', required: true },
      { key: 'note', type: 'string', required: false, size: 500 },
      { key: 'createdById', type: 'string', required: true, size: 255 },
      { key: 'createdByName', type: 'string', required: false, size: 255 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
      { key: 'updatedById', type: 'string', required: false, size: 255 },
      { key: 'updatedByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      // One row per TL per month — enforced unique.
      { key: 'tl_month_unique', type: 'unique', attributes: ['teamLeadId', 'monthKey'] },
      { key: 'month_idx', type: 'key', attributes: ['monthKey'] },
    ],
  },

  // ─── Technical Payments ──────────────────────────────────────────────────
  // One document per upfront payment collected when creating an Assessment
  // or Interview support request. Written only after the email is sent
  // successfully (never on failure / rollback). Attributed to the agent
  // who sent the email via `userId`, linked to the candidate via `leadId`.
  technical_payments: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'userId', type: 'string', required: true, size: 255 },
      { key: 'amount', type: 'integer', required: true, min: 0 },
      {
        key: 'type',
        type: 'enum',
        required: true,
        values: ['assessment', 'interview'],
      },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'user_idx', type: 'key', attributes: ['userId'] },
      { key: 'type_idx', type: 'key', attributes: ['type'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },

  // ─── Monthly Target Assignments ──────────────────────────────────────────
  // One document per (monthly_target_id, agent_id). Carries the per-agent
  // target amount a TL assigns within their monthly team target. Each
  // assignment row's `amount` is summed to compute the TL's split total;
  // the TL can save without it matching the team total exactly.
  monthly_target_assignments: {
    attributes: [
      { key: 'monthlyTargetId', type: 'string', required: true, size: 255 },
      { key: 'teamLeadId', type: 'string', required: true, size: 255 },
      { key: 'agentId', type: 'string', required: true, size: 255 },
      { key: 'agentName', type: 'string', required: false, size: 255 },
      { key: 'amount', type: 'integer', required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
      { key: 'updatedById', type: 'string', required: false, size: 255 },
      { key: 'updatedByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'target_idx', type: 'key', attributes: ['monthlyTargetId'] },
      { key: 'tl_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'agent_idx', type: 'key', attributes: ['agentId'] },
      // One assignment per (target, agent) — unique.
      { key: 'target_agent_unique', type: 'unique', attributes: ['monthlyTargetId', 'agentId'] },
    ],
  },

  // ─── Pending Amounts ────────────────────────────────────────────────────────
  // One document per (lead_id, month_key) tracking the remaining balance on
  // a client payment record. Written when an operator adds a payment update
  // with a pending amount; the status flips from "pending" to "cleared" when
  // the balance reaches zero. The unique constraint on (leadId, monthKey)
  // ensures at most one active pending row per lead per calendar month.
  pending_amounts: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'paymentRecordId', type: 'string', required: true, size: 255 },
      // YYYY-MM derived from the payment update that created / updated this row.
      { key: 'monthKey', type: 'string', required: true, size: 7 },
      { key: 'pendingAmount', type: 'integer', required: true, min: 0 },
      {
        key: 'status',
        type: 'enum',
        required: true,
        default: 'pending',
        values: ['pending', 'cleared'],
      },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
      { key: 'updatedById', type: 'string', required: false, size: 255 },
      { key: 'updatedByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_month_unique', type: 'unique', attributes: ['leadId', 'monthKey'] },
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'month_idx', type: 'key', attributes: ['monthKey'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'payment_record_idx', type: 'key', attributes: ['paymentRecordId'] },
    ],
  },

  // ─── Previous Followups Payment ────────────────────────────────────────────────────
  // One document per followup payment entry to track payments for followup services.
  // This is separate from client payments and tracks manual additions to total paid.
  previous_followups_payments: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      {
        key: 'company',
        type: 'enum',
        required: true,
        values: ['Silverspace INC', 'Flawless-ED', 'Vizva INC'],
      },
      { key: 'candidateName', type: 'string', required: true, size: 255 },
      { key: 'amount', type: 'integer', required: true },
      { key: 'date', type: 'string', required: true, size: 10 }, // YYYY-MM-DD
      { key: 'remark', type: 'string', required: false, size: 1000 },
      { key: 'status', type: 'string', required: false, size: 50, default: 'paid' },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: false },
      { key: 'updatedById', type: 'string', required: false, size: 255 },
      { key: 'updatedByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'company_idx', type: 'key', attributes: ['company'] },
      { key: 'date_idx', type: 'key', attributes: ['date'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
    ],
  },

  // ─── Holiday Calendar ───────────────────────────────────────────────────
  // One document per holiday date used to exclude weekday holidays from KPI
  // and LinkedIn target calculations. Only admins manage these rows.
  holiday_calendar: {
    attributes: [
      { key: 'holidayDate', type: 'string', required: true, size: 10 }, // YYYY-MM-DD
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'createdById', type: 'string', required: false, size: 255 },
      { key: 'createdByName', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'holiday_date_idx', type: 'unique', attributes: ['holidayDate'] },
      { key: 'created_idx', type: 'key', attributes: ['createdAt'] },
    ],
  },
};

/**
 * Returns the list of all collection IDs in this schema set.
 */
export function listCollectionIds(): string[] {
  return Object.keys(collectionSchemas);
}
