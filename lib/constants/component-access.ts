import type { ComponentKey, UserRole } from '@/lib/types';

type RoleAccessMap = Record<ComponentKey, readonly UserRole[]>;

export const COMPONENT_ACCESS: RoleAccessMap = {
  dashboard: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  chat: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  leads: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  history: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  'user-management': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  'field-management': [],
  settings: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  'branch-management': ['admin', 'developer', 'monitor', 'operations'],
  'audit-logs': ['admin', 'developer', 'monitor'],
  mock: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  'assessment-support': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  'interview-support': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  hierarchy: ['admin', 'developer', 'monitor', 'operations'],
  'work-queue': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  reports: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  'coaching-notes': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  'review-queue': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  notifications: ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  attendance: ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  'attendance-report': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  'lead-requests': ['admin', 'developer', 'monitor', 'operations'],
  'linkedin-requests': ['team_lead', 'agent', 'lead_generation'],
  'linkedin-account-management': ['admin', 'monitor', 'operations', 'team_lead'],
  'linkedin-reports': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  'payments-report': ['admin', 'developer', 'monitor', 'operations'],
  'technical-payments': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  'followups-payments': ['admin', 'developer', 'monitor', 'operations', 'team_lead'],
  // Target Report — admin reads every TL/agent, TLs split their own
  // team's target, agents see their own achievement. Monitoring roles
  // (monitor / operations) can view but not edit; the server action
  // gates writes accordingly.
  'target-report': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent', 'lead_generation'],
  // Empty by design — `resume-dashboard` opens only via the department
  // short-circuit in AccessControlProvider.canAccess (resume team members
  // and the leadership roles). Sales-team members are blocked at that gate.
  'resume-dashboard': [],
  'resume-profiles': [],
  // Same gating as resume-dashboard — opened only by the department
  // short-circuit in canAccess, never by role eligibility alone.
  'resume-chat': [],
  // Same gating as resume-dashboard / resume-chat — the resume
  // hierarchy page is a Resume-team-only view. Leadership roles can
  // open it via the short-circuit in canAccess.
  'resume-hierarchy': [],
  // Sales → Resume call-request raising page. Sales agents and team
  // leads raise requests against their own clients; leadership roles
  // can view. Resume-team members are blocked by SALES_ONLY_COMPONENTS
  // in AccessControlProvider regardless of role.
  'request-calls': ['admin', 'developer', 'monitor', 'operations', 'team_lead', 'agent'],
  // Empty by design — `call-requests` (the Resume "Calls" page) opens
  // only via the department short-circuit in AccessControlProvider
  // .canAccess (resume team members + leadership). Sales-team members
  // are blocked at that gate.
  'call-requests': [],
};

export function isRoleEligibleForComponent(
  componentKey: ComponentKey,
  role: UserRole
): boolean {
  return COMPONENT_ACCESS[componentKey]?.includes(role) ?? false;
}

export function getDefaultComponentAccess(
  componentKey: ComponentKey,
  role: UserRole
): boolean {
  return isRoleEligibleForComponent(componentKey, role);
}
