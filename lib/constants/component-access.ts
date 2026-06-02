import type { ComponentKey, UserRole } from '@/lib/types';

type RoleAccessMap = Record<ComponentKey, readonly UserRole[]>;

export const COMPONENT_ACCESS: RoleAccessMap = {
  dashboard: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  chat: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  leads: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  history: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  'user-management': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'],
  'field-management': [],
  settings: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  'branch-management': ['admin', 'developer'],
  'audit-logs': ['admin', 'developer'],
  mock: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  'assessment-support': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  'interview-support': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  hierarchy: ['admin', 'developer', 'manager', 'assistant_manager'],
  'work-queue': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  reports: ['admin', 'developer', 'team_lead', 'agent'],
  'coaching-notes': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'],
  'review-queue': ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'],
  notifications: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  attendance: ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'],
  'linkedin-requests': ['agent'],
  'linkedin-account-management': ['admin', 'developer', 'team_lead'],
  'linkedin-reports': ['admin', 'developer', 'team_lead'],
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
