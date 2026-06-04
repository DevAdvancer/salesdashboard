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
  | 'linkedin-reports';

export type UserRole = 'admin' | 'developer' | 'team_lead' | 'agent' | 'lead_generation' | 'monitor';

export interface AccessRule {
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

export const DEFAULT_ACCESS_RULES: AccessRule[] = [
  // Admin rules — all allowed
  { componentKey: 'dashboard', role: 'admin', allowed: true },
  { componentKey: 'chat', role: 'admin', allowed: true },
  { componentKey: 'leads', role: 'admin', allowed: true },
  { componentKey: 'history', role: 'admin', allowed: true },
  { componentKey: 'user-management', role: 'admin', allowed: true },
  { componentKey: 'field-management', role: 'admin', allowed: false },
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
  { componentKey: 'attendance', role: 'admin', allowed: true },
  { componentKey: 'attendance-report', role: 'admin', allowed: true },
  { componentKey: 'lead-requests', role: 'admin', allowed: true },
  { componentKey: 'linkedin-requests', role: 'admin', allowed: false },
  { componentKey: 'linkedin-account-management', role: 'admin', allowed: true },
  { componentKey: 'linkedin-reports', role: 'admin', allowed: true },
  // Developer rules — identical to admin
  { componentKey: 'dashboard', role: 'developer', allowed: true },
  { componentKey: 'chat', role: 'developer', allowed: true },
  { componentKey: 'leads', role: 'developer', allowed: true },
  { componentKey: 'history', role: 'developer', allowed: true },
  { componentKey: 'user-management', role: 'developer', allowed: true },
  { componentKey: 'field-management', role: 'developer', allowed: false },
  { componentKey: 'settings', role: 'developer', allowed: true },
  { componentKey: 'branch-management', role: 'developer', allowed: true },
  { componentKey: 'audit-logs', role: 'developer', allowed: true },
  { componentKey: 'mock', role: 'developer', allowed: true },
  { componentKey: 'assessment-support', role: 'developer', allowed: true },
  { componentKey: 'interview-support', role: 'developer', allowed: true },
  { componentKey: 'hierarchy', role: 'developer', allowed: true },
  { componentKey: 'work-queue', role: 'developer', allowed: true },
  { componentKey: 'reports', role: 'developer', allowed: true },
  { componentKey: 'coaching-notes', role: 'developer', allowed: true },
  { componentKey: 'review-queue', role: 'developer', allowed: true },
  { componentKey: 'notifications', role: 'developer', allowed: true },
  { componentKey: 'attendance', role: 'developer', allowed: true },
  { componentKey: 'attendance-report', role: 'developer', allowed: true },
  { componentKey: 'lead-requests', role: 'developer', allowed: true },
  { componentKey: 'linkedin-requests', role: 'developer', allowed: false },
  { componentKey: 'linkedin-account-management', role: 'developer', allowed: true },
  { componentKey: 'linkedin-reports', role: 'developer', allowed: true },
  // Monitor rules - admin-level visibility without mutation privileges
  { componentKey: 'dashboard', role: 'monitor', allowed: true },
  { componentKey: 'chat', role: 'monitor', allowed: true },
  { componentKey: 'leads', role: 'monitor', allowed: true },
  { componentKey: 'history', role: 'monitor', allowed: true },
  { componentKey: 'user-management', role: 'monitor', allowed: true },
  { componentKey: 'field-management', role: 'monitor', allowed: false },
  { componentKey: 'settings', role: 'monitor', allowed: true },
  { componentKey: 'branch-management', role: 'monitor', allowed: true },
  { componentKey: 'audit-logs', role: 'monitor', allowed: true },
  { componentKey: 'mock', role: 'monitor', allowed: true },
  { componentKey: 'assessment-support', role: 'monitor', allowed: true },
  { componentKey: 'interview-support', role: 'monitor', allowed: true },
  { componentKey: 'hierarchy', role: 'monitor', allowed: true },
  { componentKey: 'work-queue', role: 'monitor', allowed: true },
  { componentKey: 'reports', role: 'monitor', allowed: true },
  { componentKey: 'coaching-notes', role: 'monitor', allowed: true },
  { componentKey: 'review-queue', role: 'monitor', allowed: true },
  { componentKey: 'notifications', role: 'monitor', allowed: true },
  { componentKey: 'attendance', role: 'monitor', allowed: true },
  { componentKey: 'attendance-report', role: 'monitor', allowed: true },
  { componentKey: 'lead-requests', role: 'monitor', allowed: true },
  { componentKey: 'linkedin-requests', role: 'monitor', allowed: false },
  { componentKey: 'linkedin-account-management', role: 'monitor', allowed: true },
  { componentKey: 'linkedin-reports', role: 'monitor', allowed: true },
  // Team Lead rules
  { componentKey: 'dashboard', role: 'team_lead', allowed: true },
  { componentKey: 'chat', role: 'team_lead', allowed: true },
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
  { componentKey: 'attendance', role: 'team_lead', allowed: true },
  { componentKey: 'attendance-report', role: 'team_lead', allowed: true },
  { componentKey: 'lead-requests', role: 'team_lead', allowed: false },
  { componentKey: 'linkedin-requests', role: 'team_lead', allowed: false },
  { componentKey: 'linkedin-account-management', role: 'team_lead', allowed: true },
  { componentKey: 'linkedin-reports', role: 'team_lead', allowed: true },
  // Agent rules
  { componentKey: 'dashboard', role: 'agent', allowed: true },
  { componentKey: 'chat', role: 'agent', allowed: true },
  { componentKey: 'leads', role: 'agent', allowed: true },
  { componentKey: 'history', role: 'agent', allowed: true },
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
  { componentKey: 'attendance', role: 'agent', allowed: false },
  { componentKey: 'attendance-report', role: 'agent', allowed: false },
  { componentKey: 'lead-requests', role: 'agent', allowed: false },
  { componentKey: 'linkedin-requests', role: 'agent', allowed: true },
  { componentKey: 'linkedin-account-management', role: 'agent', allowed: false },
  { componentKey: 'linkedin-reports', role: 'agent', allowed: false },
  // Lead Generation rules
  { componentKey: 'dashboard', role: 'lead_generation', allowed: true },
  { componentKey: 'chat', role: 'lead_generation', allowed: true },
  { componentKey: 'leads', role: 'lead_generation', allowed: true },
  { componentKey: 'history', role: 'lead_generation', allowed: false },
  { componentKey: 'user-management', role: 'lead_generation', allowed: false },
  { componentKey: 'field-management', role: 'lead_generation', allowed: false },
  { componentKey: 'settings', role: 'lead_generation', allowed: true },
  { componentKey: 'branch-management', role: 'lead_generation', allowed: false },
  { componentKey: 'audit-logs', role: 'lead_generation', allowed: false },
  { componentKey: 'mock', role: 'lead_generation', allowed: false },
  { componentKey: 'assessment-support', role: 'lead_generation', allowed: false },
  { componentKey: 'interview-support', role: 'lead_generation', allowed: false },
  { componentKey: 'hierarchy', role: 'lead_generation', allowed: false },
  { componentKey: 'work-queue', role: 'lead_generation', allowed: false },
  { componentKey: 'reports', role: 'lead_generation', allowed: false },
  { componentKey: 'coaching-notes', role: 'lead_generation', allowed: false },
  { componentKey: 'review-queue', role: 'lead_generation', allowed: false },
  { componentKey: 'notifications', role: 'lead_generation', allowed: true },
  { componentKey: 'attendance', role: 'lead_generation', allowed: false },
  { componentKey: 'attendance-report', role: 'lead_generation', allowed: false },
  { componentKey: 'lead-requests', role: 'lead_generation', allowed: false },
  { componentKey: 'linkedin-requests', role: 'lead_generation', allowed: false },
  { componentKey: 'linkedin-account-management', role: 'lead_generation', allowed: false },
  { componentKey: 'linkedin-reports', role: 'lead_generation', allowed: false },
];
