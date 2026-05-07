export type ComponentKey =
  | 'dashboard'
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
  | 'notifications';

export type UserRole = 'admin' | 'manager' | 'assistant_manager' | 'team_lead' | 'agent';

export interface AccessRule {
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

export const DEFAULT_ACCESS_RULES: AccessRule[] = [
  // Admin rules — all allowed
  { componentKey: 'dashboard', role: 'admin', allowed: true },
  { componentKey: 'leads', role: 'admin', allowed: true },
  { componentKey: 'history', role: 'admin', allowed: true },
  { componentKey: 'user-management', role: 'admin', allowed: true },
  { componentKey: 'field-management', role: 'admin', allowed: true },
  { componentKey: 'settings', role: 'admin', allowed: true },
  { componentKey: 'branch-management', role: 'admin', allowed: true },
  { componentKey: 'audit-logs', role: 'admin', allowed: true },
  { componentKey: 'mock', role: 'admin', allowed: true },
  { componentKey: 'assessment-support', role: 'admin', allowed: true },
  { componentKey: 'interview-support', role: 'admin', allowed: true },
  { componentKey: 'hierarchy', role: 'admin', allowed: true },
  { componentKey: 'work-queue', role: 'admin', allowed: true },
  { componentKey: 'reports', role: 'admin', allowed: true },
  { componentKey: 'coaching-notes', role: 'admin', allowed: true },
  { componentKey: 'review-queue', role: 'admin', allowed: true },
  { componentKey: 'notifications', role: 'admin', allowed: true },
  // Manager rules
  { componentKey: 'dashboard', role: 'manager', allowed: true },
  { componentKey: 'leads', role: 'manager', allowed: true },
  { componentKey: 'history', role: 'manager', allowed: true },
  { componentKey: 'user-management', role: 'manager', allowed: true },
  { componentKey: 'field-management', role: 'manager', allowed: true },
  { componentKey: 'settings', role: 'manager', allowed: true },
  { componentKey: 'branch-management', role: 'manager', allowed: false },
  { componentKey: 'audit-logs', role: 'manager', allowed: false },
  { componentKey: 'mock', role: 'manager', allowed: true },
  { componentKey: 'assessment-support', role: 'manager', allowed: true },
  { componentKey: 'interview-support', role: 'manager', allowed: true },
  { componentKey: 'hierarchy', role: 'manager', allowed: true },
  { componentKey: 'work-queue', role: 'manager', allowed: true },
  { componentKey: 'reports', role: 'manager', allowed: true },
  { componentKey: 'coaching-notes', role: 'manager', allowed: true },
  { componentKey: 'review-queue', role: 'manager', allowed: true },
  { componentKey: 'notifications', role: 'manager', allowed: true },
  // Assistant Manager rules
  { componentKey: 'dashboard', role: 'assistant_manager', allowed: true },
  { componentKey: 'leads', role: 'assistant_manager', allowed: true },
  { componentKey: 'history', role: 'assistant_manager', allowed: true },
  { componentKey: 'user-management', role: 'assistant_manager', allowed: true },
  { componentKey: 'field-management', role: 'assistant_manager', allowed: true },
  { componentKey: 'settings', role: 'assistant_manager', allowed: true },
  { componentKey: 'branch-management', role: 'assistant_manager', allowed: false },
  { componentKey: 'audit-logs', role: 'assistant_manager', allowed: false },
  { componentKey: 'mock', role: 'assistant_manager', allowed: true },
  { componentKey: 'assessment-support', role: 'assistant_manager', allowed: true },
  { componentKey: 'interview-support', role: 'assistant_manager', allowed: true },
  { componentKey: 'hierarchy', role: 'assistant_manager', allowed: true },
  { componentKey: 'work-queue', role: 'assistant_manager', allowed: true },
  { componentKey: 'reports', role: 'assistant_manager', allowed: true },
  { componentKey: 'coaching-notes', role: 'assistant_manager', allowed: true },
  { componentKey: 'review-queue', role: 'assistant_manager', allowed: true },
  { componentKey: 'notifications', role: 'assistant_manager', allowed: true },
  // Team Lead rules
  { componentKey: 'dashboard', role: 'team_lead', allowed: true },
  { componentKey: 'leads', role: 'team_lead', allowed: true },
  { componentKey: 'history', role: 'team_lead', allowed: true },
  { componentKey: 'user-management', role: 'team_lead', allowed: true },
  { componentKey: 'field-management', role: 'team_lead', allowed: false },
  { componentKey: 'settings', role: 'team_lead', allowed: true },
  { componentKey: 'branch-management', role: 'team_lead', allowed: false },
  { componentKey: 'audit-logs', role: 'team_lead', allowed: false },
  { componentKey: 'mock', role: 'team_lead', allowed: true },
  { componentKey: 'assessment-support', role: 'team_lead', allowed: true },
  { componentKey: 'interview-support', role: 'team_lead', allowed: true },
  { componentKey: 'hierarchy', role: 'team_lead', allowed: false },
  { componentKey: 'work-queue', role: 'team_lead', allowed: true },
  { componentKey: 'reports', role: 'team_lead', allowed: false },
  { componentKey: 'coaching-notes', role: 'team_lead', allowed: false },
  { componentKey: 'review-queue', role: 'team_lead', allowed: true },
  { componentKey: 'notifications', role: 'team_lead', allowed: true },
  // Agent rules
  { componentKey: 'dashboard', role: 'agent', allowed: true },
  { componentKey: 'leads', role: 'agent', allowed: true },
  { componentKey: 'history', role: 'agent', allowed: false },
  { componentKey: 'user-management', role: 'agent', allowed: false },
  { componentKey: 'field-management', role: 'agent', allowed: false },
  { componentKey: 'settings', role: 'agent', allowed: true },
  { componentKey: 'branch-management', role: 'agent', allowed: false },
  { componentKey: 'audit-logs', role: 'agent', allowed: false },
  { componentKey: 'mock', role: 'agent', allowed: true },
  { componentKey: 'assessment-support', role: 'agent', allowed: true },
  { componentKey: 'interview-support', role: 'agent', allowed: true },
  { componentKey: 'hierarchy', role: 'agent', allowed: false },
  { componentKey: 'work-queue', role: 'agent', allowed: true },
  { componentKey: 'reports', role: 'agent', allowed: false },
  { componentKey: 'coaching-notes', role: 'agent', allowed: false },
  { componentKey: 'review-queue', role: 'agent', allowed: false },
  { componentKey: 'notifications', role: 'agent', allowed: true },
];
