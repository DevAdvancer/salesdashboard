// User types
export type UserRole = 'admin' | 'developer' | 'team_lead' | 'agent' | 'lead_generation' | 'monitor' | 'operations';

export const VALID_ROLES: UserRole[] = ['admin', 'developer', 'team_lead', 'agent', 'lead_generation', 'monitor', 'operations'];

export function isValidRole(value: string): value is UserRole {
  return VALID_ROLES.includes(value as UserRole);
}

// Department splits the workforce between the existing Sales team and a
// parallel Resume team. Defaults to 'sales' for legacy user docs that predate
// the field; the schema-sync backfill sets 'sales' on every existing record.
export type Department = 'sales' | 'resume';

export const VALID_DEPARTMENTS: Department[] = ['sales', 'resume'];

export function isValidDepartment(value: string): value is Department {
  return VALID_DEPARTMENTS.includes(value as Department);
}

export interface User {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  /** @default 'sales' — set explicitly to 'resume' for Resume team members. */
  department: Department;
  teamLeadId: string | null;
  branchIds: string[];
  isActive?: boolean;
  /** @deprecated Use branchIds instead */
  branchId?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  department?: Department;
  teamLeadId?: string;
  branchIds: string[];
}

export interface CreateTeamLeadInput {
  name: string;
  email: string;
  password: string;
  department?: Department;
  branchIds: string[];
}

export interface CreateAgentInput {
  name: string;
  email: string;
  password: string;
  role?: Extract<UserRole, 'agent' | 'lead_generation' | 'monitor' | 'operations'>;
  department?: Department;
  teamLeadId?: string;
  branchIds: string[];
}

// Lead types
export interface Lead {
  $id: string;
  data: string; // JSON serialized lead data
  status: string;
  ownerId: string;
  assignedToId: string | null;
  branchId: string | null;
  isClosed: boolean;
  closedAt: string | null;
  nextFollowUpAt?: string | null;
  nextAction?: string | null;
  lastContactedAt?: string | null;
  followUpStatus?: 'pending' | 'completed' | 'overdue' | string | null;
  $createdAt?: string;
  $updatedAt?: string;
  $permissions?: string[];
}

// One row per (lead, original TL) LG → TL handoff. Written at the
// moment a lead_generation actor hands a lead to a Team Lead and
// never updated. The "Lead Gen Team Handoffs" dashboard groups these
// rows by `teamLeadId` to compute the per-TL count, which is exact
// by construction because a later reassignment never produces a new
// row. Indexed on `leadId` (unique) so each lead can have at most
// one handoff row.
export interface LgHandoff {
  $id: string;
  leadId: string;
  teamLeadId: string;
  leadGenerationId: string;
  handedOffAt: string;
  branchId?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

// Lifecycle of a not_interested_leads row.
export type NotInterestedStatus = 'active' | 'reopened';

// One row per "Not Interested" marking event. A lead can have multiple
// rows across its lifetime — each time an agent marks it not-interested
// a fresh `active` row is written; the prior `active` row is flipped to
// `reopened` in the same transaction. Reports count only `status: 'active'`
// rows in the selected date range, attributed to the agent who previously
// owned the lead (`previousOwnerId`).
export interface NotInterestedLeadEvent {
  $id: string;
  leadId: string;
  markedById: string;
  markedByName: string;
  markedAt: string;
  previousOwnerId: string;
  previousAssignedToId?: string | null;
  branchId?: string | null;
  reason?: string | null;
  status: NotInterestedStatus;
  reopenedAt?: string | null;
  reopenedById?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export type LeadDataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[]
  | Record<string, unknown>
  | unknown[];

export type LeadData = Record<string, LeadDataValue>;

// Branch types
export interface Branch {
  $id: string;
  name: string;
  isActive: boolean;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface CreateBranchInput {
  name: string;
}

export interface UpdateBranchInput {
  name?: string;
  isActive?: boolean;
}

// Lead validation types
export interface LeadValidationResult {
  isValid: boolean;
  duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl';
  existingLeadId?: string;
  existingBranchId?: string;
}

export interface CreateLeadInput {
  data: LeadData;
  assignedToId?: string;
  status: string;
  branchId?: string | null;
}

export type LeadRequestStatus = 'pending' | 'moved' | 'rejected';

// ─── Call Requests (Sales → Resume) ─────────────────────────────────────────
// A Sales agent/team_lead raises a call request against one of their clients.
// The Resume team lead sees it on the Calls page and either handles it or
// assigns it to a Resume user. Status walks not_called → pending_documents →
// call_done. The per-request chat is stored as a JSON array on the document —
// each message is tagged with the sender's team so the same thread renders
// "Sales" and "Resume" sides. System lines (status changes) use team 'system'.
export type CallRequestStatus = 'not_called' | 'pending_documents' | 'call_done';

export const CALL_REQUEST_STATUSES: CallRequestStatus[] = [
  'not_called',
  'pending_documents',
  'call_done',
];

export function isValidCallRequestStatus(value: string): value is CallRequestStatus {
  return CALL_REQUEST_STATUSES.includes(value as CallRequestStatus);
}

export type CallRequestChatTeam = 'sales' | 'resume' | 'system';

export interface CallRequestChatMessage {
  id: string;
  team: CallRequestChatTeam;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

// One snapshot entry of the document checklist confirmed at submit time.
export interface CallRequestChecklistItem {
  key: string;
  label: string;
  confirmed: boolean;
}

export interface CallRequest {
  $id: string;
  leadId: string;
  clientName: string;
  status: CallRequestStatus;
  requestedById: string;
  requestedByName: string;
  assignedToId?: string | null;
  assignedToName?: string | null;
  /** JSON string: CallRequestChecklistItem[] */
  documentsChecklist?: string | null;
  /** JSON string: CallRequestChatMessage[] */
  chat?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export type ResumeProfileStage =
  | '1. Draft'
  | '2. Sent'
  | '3. Modification /Approval (candidate/client)'
  | '4. Marketing'
  | '5. Doc Missing (Not calculated in the timeline)';

export const RESUME_PROFILE_STAGES: ResumeProfileStage[] = [
  '1. Draft',
  '2. Sent',
  '3. Modification /Approval (candidate/client)',
  '4. Marketing',
  '5. Doc Missing (Not calculated in the timeline)',
];

export interface ResumeProfile {
  $id: string;
  callRequestId?: string | null;
  leadId?: string | null;
  candidateName: string;
  technology?: string | null;
  usaArrival?: string | null;
  bachelors?: string | null;
  masters?: string | null;
  cpt?: string | null;
  cptDetails?: string | null;
  opt?: string | null;
  optDetails?: string | null;
  stemOpt?: string | null;
  stemOptDetails?: string | null;
  indiaExperience?: string | null;
  missingDocs?: string | null;
  resumeTimeline?: string | null;
  remarks?: string | null;
  stage: ResumeProfileStage | string;
  assignedToId?: string | null;
  assignedToName?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  stageUpdatedAt?: string | null;
  lastAlertStage?: string | null;
  lastAlertAt?: string | null;
  /** True once promoted to the Marketing page (analogous to a lead's isClosed). */
  movedToMarketing?: boolean | null;
  marketingMovedAt?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface LeadRequest {
  $id: string;
  name: string;
  email: string;
  phone: string;
  linkedinProfileUrl: string;
  city: string;
  interestedService: string;
  referrerName: string;
  notes: string;
  referrerCompany?: string;
  bonusAmount?: string;
  paymentDate?: string;
  paymentMode?: string;
  salesPerson?: string;
  data: string;
  status: LeadRequestStatus | string;
  duplicateMessage?: string | null;
  movedLeadId?: string | null;
  movedById?: string | null;
  movedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface LeadListFilters {
  status?: string;
  assignedToId?: string;
  ownerId?: string;
  branchId?: string;
  teamLeadId?: string;
  dateFrom?: string;
  dateTo?: string;
  closedAtFrom?: string;
  closedAtTo?: string;
  searchQuery?: string;
  isClosed?: boolean;
}

// Form configuration types
export type FieldType = 'text' | 'email' | 'phone' | 'dropdown' | 'textarea' | 'checklist';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  key: string;
  required: boolean;
  visible: boolean;
  order: number;
  options?: string[];
  placeholder?: string;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

export interface FormConfig {
  $id: string;
  fields: string; // JSON serialized FormField[]
  version: number;
  updatedBy: string;
  $createdAt?: string;
  $updatedAt?: string;
}

// Access configuration types
export type ComponentKey =
  | 'dashboard'
  | 'chat'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management'
  | 'audit-logs'
  | 'mock'
  | 'assessment-support'
  | 'interview-support'
  | 'hierarchy'
  | 'work-queue'
  | 'reports'
  | 'coaching-notes'
  | 'review-queue'
  | 'notifications'
  | 'attendance'
  | 'attendance-report'
  | 'lead-requests'
  | 'linkedin-requests'
  | 'linkedin-account-management'
  | 'linkedin-reports'
  | 'payments-report'
  | 'target-report'
  | 'resume-dashboard'
  | 'resume-profiles'
  | 'resume-marketing'
  | 'resume-chat'
  | 'resume-hierarchy'
  | 'technical-payments'
  | 'followups-payments'
  | 'request-calls'
  | 'call-requests';

export interface AccessRule {
  $id?: string;
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

export interface AccessConfig {
  rules: AccessRule[];
  canAccess: (componentKey: ComponentKey, role: UserRole) => boolean;
}

export type LinkedinAccountType = 'main' | 'sudo';

export interface LinkedinAccount {
  $id: string;
  assignedUserId: string;
  teamLeadId: string | null;
  company: string;
  idName: string;
  accountType: LinkedinAccountType;
  mainAccountId: string | null;
  isActive: boolean;
  licenseType?: string;
  connectionLimit?: number;
  createdBy?: string;
  updatedBy?: string;
  $createdAt?: string;
  $updatedAt?: string;
}

export type LinkedinRequestStatus = 'sent' | 'accepted' | 'withdrawn';

export interface LinkedinRequest {
  $id: string;
  accountId: string;
  agentId: string;
  teamLeadId: string | null;
  company: string;
  targetUrl: string;
  coldCall?: boolean;
  coldCallPhone?: string | null;
  dateSent: string;
  status: LinkedinRequestStatus;
  acceptedAt: string | null;
  leadId?: string | null;
  withdrawnAt?: string | null;
  isActive?: boolean;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface AttendanceRecord {
  $id: string;
  dateKey: string;
  userId: string;
  teamLeadId: string | null;
  present: boolean;
  presentAt: string | null;
  outlookConnected: boolean;
  lastSeenAt: string | null;
  lastSeenPath: string | null;
  absentNotifiedAt: string | null;
  adminEscalatedAt: string | null;
  delegateUserId: string | null;
  assignedById: string | null;
  assignedAt: string | null;
  presentWithDelegateFlag?: boolean;
  $createdAt?: string;
  $updatedAt?: string;
}

export type ChatChannelType = 'announcement' | 'general';

export interface ChatMessage {
  $id: string;
  channel: ChatChannelType;
  /**
   * Department the message belongs to. Each team (Sales / Resume) has its
   * own pair of channels (announcement / general) — messages are never
   * shared across departments. Leadership roles (admin/developer/monitor/
   * operations) can read and post in either department by switching the
   * sidebar view; the department on the message is what was active at
   * post time.
   */
  department: Department;
  body: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  $createdAt?: string;
  $updatedAt?: string;
}

// Audit Log types
export type AuditLogAction =
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'LEAD_CREATE'
  | 'LEAD_UPDATE'
  | 'LEAD_DELETE'
  | 'FORM_CONFIG_UPDATE'
  | 'SETTINGS_UPDATE'
  | 'BRANCH_CREATE'
  | 'BRANCH_UPDATE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'MOCK_EMAIL_SENT'
  | 'INTERVIEW_EMAIL_SENT'
  | 'ASSESSMENT_EMAIL_SENT';

export interface AuditLog {
  $id: string;
  action: string;
  actorId: string;
  actorName: string;
  targetId?: string;
  targetType: string;
  metadata?: string; // JSON string
  performedAt: string;
}

// Authentication context types
export interface AuthContext {
  user: User | null;
  isAdmin: boolean;
  isDeveloper: boolean;
  isTeamLead: boolean;
  isAgent: boolean;
  isLeadGeneration: boolean;
  isMonitor: boolean;
  isOperations: boolean;
  isResumeTeam: boolean;
  isSalesTeam: boolean;
  canManageAttendance: boolean;
  /**
   * The dashboard the user is currently viewing. For leadership roles
   * (admin/developer/monitor/operations) this can differ from
   * `user.department` because they can switch dashboards from the sidebar.
   * For all other users it always matches `user.department`.
   */
  activeDashboard: Department;
  /**
   * True when the current role is allowed to switch dashboards in-app.
   * Only leadership roles (admin/developer/monitor/operations) get this.
   */
  canSwitchDashboard: boolean;
  /**
   * Switch the active dashboard. Only takes effect when `canSwitchDashboard`
   * is true; otherwise it is a no-op.
   */
  setActiveDashboard: (next: Department) => void;
  loading: boolean;
  /**
   * True once `syncServerSession` has finished its first attempt for the
   * current session. Pages that call server actions on mount should wait
   * for this flag so the crm_appwrite_jwt cookie is in place before the
   * first request — otherwise createSessionClient falls through to the
   * legacy a_session_* cookie loop and may 500 with "No session".
   */
  serverSessionReady: boolean;
  login: (email: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
}

// History types
export interface HistoryFilters {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  agentId?: string;
  status?: string;
  closedBy?: string;
}

export interface HistoryEntry extends Lead {
  isClosed: true;
  closedAt: string;
}

export type PaymentStatus = 'not_paid' | 'partially_paid' | 'fully_paid' | 'non_upfront';

export interface ClientPaymentPlan {
  percent: number;
  months: number;
  upfrontAmount: number;
}

export interface ClientPaymentUpdate {
  id: string;
  status: PaymentStatus;
  note?: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
  /** Amount paid on this specific update, if any. Stored in the
   * `updates` JSON string; older records have no amount. */
  amount?: number | null;
}

export interface ClientPaymentRecord {
  $id: string;
  leadId: string;
  personalDetails: Record<string, unknown>;
  paymentPlan: ClientPaymentPlan;
  status: PaymentStatus;
  updates: ClientPaymentUpdate[];
  createdAt: string;
  updatedAt?: string | null;
  lastReminderAt?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

export type LeadNoteVisibility = 'team' | 'leadership' | 'private';

export interface LeadNote {
  $id: string;
  leadId: string;
  authorId: string;
  authorName: string;
  body: string;
  visibility: LeadNoteVisibility;
  createdAt: string;
  updatedAt?: string | null;
}

export type CoachingNoteVisibility = 'private' | 'leadership';

export interface CoachingNote {
  $id: string;
  targetUserId: string;
  targetUserName?: string | null;
  authorId: string;
  authorName: string;
  note: string;
  visibility: CoachingNoteVisibility;
  createdAt: string;
  updatedAt?: string | null;
}

export type ReviewQueueStatus = 'open' | 'approved' | 'rejected' | 'resolved';

export interface ReviewQueueItem {
  $id: string;
  type: string;
  status: ReviewQueueStatus | string;
  targetId: string;
  targetType: string;
  requestedById: string;
  requestedByName: string;
  assignedReviewerId?: string | null;
  reason?: string | null;
  metadata?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface NotificationRecord {
  $id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  targetId?: string | null;
  targetType?: string | null;
  readAt?: string | null;
  createdAt: string;
}

// Aggregate counter of how many leads a Team Lead has received from
// lead_generation actors. Document id == TL user id. See
// app/actions/tl-lead-counts.ts.
export interface TlLeadCount {
  $id: string;
  userId: string;
  leadCount: number;
  updatedAt: string;
}

// ─── Monthly Targets ────────────────────────────────────────────────────
// One document per (team_lead_id, month_key). Admins set the total
// amount for a TL's team for the month; TLs then split that total
// across their agents via MonthlyTargetAssignment rows.
export interface MonthlyTarget {
  $id: string;
  teamLeadId: string;
  teamLeadName?: string | null;
  /** YYYY-MM (e.g. "2026-06") */
  monthKey: string;
  /** The total target amount the admin set for the TL's team. */
  totalAmount: number;
  note?: string | null;
  createdById: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

// One document per (monthly_target_id, agent_id). Carries the
// per-agent target amount a TL assigns within their team's monthly
// target. `amount` is summed to derive the TL's split total.
export interface MonthlyTargetAssignment {
  $id: string;
  monthlyTargetId: string;
  teamLeadId: string;
  agentId: string;
  agentName?: string | null;
  amount: number;
  createdAt: string;
  updatedAt?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

// One document per upfront payment collected when an Assessment or Interview
// support email is sent successfully. Written only after the email succeeds.
export interface TechnicalPayment {
  $id: string;
  leadId: string;
  userId: string;
  amount: number;
  type: 'assessment' | 'interview';
  createdAt: string;
}

// ─── Pending Amounts ─────────────────────────────────────────────────────────
// Tracks the remaining balance on a client payment record, bucketed by
// calendar month (YYYY-MM). When an operator adds a payment update with a
// pending amount the remaining balance is written here; when the balance
// reaches zero the row is marked "cleared".
export type PendingAmountStatus = 'pending' | 'cleared';

export interface PendingAmount {
  $id: string;
  leadId: string;
  paymentRecordId: string;
  /** YYYY-MM, e.g. "2026-07" */
  monthKey: string;
  pendingAmount: number;
  status: PendingAmountStatus;
  createdAt: string;
  updatedAt?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

export type FollowupsPaymentCompany =
  | 'Silverspace INC'
  | 'Flawless-ED'
  | 'Vizva INC';

export const FOLLOWUPS_PAYMENT_COMPANIES: FollowupsPaymentCompany[] = [
  'Silverspace INC',
  'Flawless-ED',
  'Vizva INC',
];

export type FollowupsPaymentStatus = 'paid';

export interface PreviousFollowupsPayment {
  $id: string;
  leadId: string;
  company: FollowupsPaymentCompany;
  candidateName: string;
  amount: number;
  date: string; // YYYY-MM-DD
  remark?: string | null;
  status: FollowupsPaymentStatus;
  createdAt: string;
  updatedAt?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

export interface HolidayCalendarEntry {
  $id: string;
  date: string;
  name: string;
  createdAt: string;
  createdById?: string | null;
  createdByName?: string | null;
}
