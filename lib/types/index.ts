// User types
export type UserRole = 'manager' | 'agent';

export interface User {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  managerId: string | null;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface CreateAgentInput {
  name: string;
  email: string;
  password: string;
}

// Lead types
export interface Lead {
  $id: string;
  data: string; // JSON serialized lead data
  status: string;
  ownerId: string;
  assignedToId: string | null;
  isClosed: boolean;
  closedAt: string | null;
  $createdAt?: string;
  $updatedAt?: string;
  $permissions?: string[];
}

export interface LeadData {
  [key: string]: any;
}

export interface CreateLeadInput {
  data: LeadData;
  ownerId: string;
  assignedToId?: string;
  status: string;
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
  | 'settings';

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
  isManager: boolean;
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
