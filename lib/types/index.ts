// User types
export type UserRole = 'admin' | 'manager' | 'assistant_manager' | 'team_lead' | 'agent' | 'lead_generation';

export const VALID_ROLES: UserRole[] = ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'];

export function isValidRole(value: string): value is UserRole {
  return VALID_ROLES.includes(value as UserRole);
}

export interface User {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  managerId: string | null; // @deprecated Use managerIds instead
  managerIds?: string[]; // New field for multiple managers
  assistantManagerId?: string | null; // @deprecated Use assistantManagerIds instead
  assistantManagerIds?: string[]; // New field for multiple assistant managers
  teamLeadId: string | null;
  branchIds: string[];
  isActive?: boolean;
  /** @deprecated Use branchIds instead */
  branchId?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface CreateManagerInput {
  name: string;
  email: string;
  password: string;
  branchIds: string[];
}

export interface CreateAssistantManagerInput {
  name: string;
  email: string;
  password: string;
  managerIds?: string[];
  branchIds: string[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  managerId?: string;
  managerIds?: string[];
  assistantManagerId?: string;
  assistantManagerIds?: string[];
  teamLeadId?: string;
  branchIds: string[];
}

export interface CreateTeamLeadInput {
  name: string;
  email: string;
  password: string;
  managerId?: string;
  managerIds?: string[];
  assistantManagerId?: string;
  assistantManagerIds?: string[];
  branchIds: string[];
}

export interface CreateAgentInput {
  name: string;
  email: string;
  password: string;
  role?: Extract<UserRole, 'agent' | 'lead_generation'>;
  teamLeadId?: string;
  managerId?: string;
  managerIds?: string[]; // Added managerIds
  assistantManagerId?: string;
  assistantManagerIds?: string[];
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
  duplicateField?: 'email' | 'phone';
  existingLeadId?: string;
  existingBranchId?: string;
}

export interface CreateLeadInput {
  data: LeadData;
  assignedToId?: string;
  status: string;
  branchId?: string | null;
}

export interface LeadListFilters {
  status?: string;
  assignedToId?: string;
  ownerId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
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
  | 'linkedin-requests'
  | 'linkedin-account-management'
  | 'linkedin-reports';

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
  dateSent: string;
  status: LinkedinRequestStatus;
  acceptedAt: string | null;
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
  isManager: boolean;
  isAssistantManager: boolean;
  isTeamLead: boolean;
  isAgent: boolean;
  isLeadGeneration: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

export type LeadNoteVisibility = 'team' | 'leadership' | 'manager_only';

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

export type CoachingNoteVisibility = 'manager_only' | 'leadership';

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
