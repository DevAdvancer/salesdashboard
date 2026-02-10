// User types
export type UserRole = 'admin' | 'manager' | 'team_lead' | 'agent';

export const VALID_ROLES: UserRole[] = ['admin', 'manager', 'team_lead', 'agent'];

export function isValidRole(value: string): value is UserRole {
  return VALID_ROLES.includes(value as UserRole);
}

export interface User {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  managerId: string | null;
  teamLeadId: string | null;
  branchIds: string[];
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

export interface CreateTeamLeadInput {
  name: string;
  email: string;
  password: string;
  managerId: string;
  branchIds: string[];

  export interface CreateManagerInput {
    name: string;
    email: string;
    password: string;
    branchIds: string[];
  }
}

export interface CreateAgentInput {
  name: string;
  email: string;
  password: string;
  teamLeadId: string;
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
  $createdAt?: string;
  $updatedAt?: string;
  $permissions?: string[];
}

export interface LeadData {
  [key: string]: any;
}

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
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management';

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

// Authentication context types
export interface AuthContext {
  user: User | null;
  isAdmin: boolean;
  isManager: boolean;
  isTeamLead: boolean;
  isAgent: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
}

// History types
export interface HistoryFilters {
  dateFrom?: string;
  dateTo?: string;
  agentId?: string;
  status?: string;
  closedBy?: string;
}

export interface HistoryEntry extends Lead {
  isClosed: true;
  closedAt: string;
}
