import type { ComponentKey, UserRole } from '@/lib/types';

type RoleAccessMap = Record<ComponentKey, readonly UserRole[]>;

export const COMPONENT_ACCESS: RoleAccessMap = {
  dashboard: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  chat: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  leads: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  history: ['admin', 'manager', 'assistant_manager', 'team_lead'],
  'user-management': ['admin', 'manager', 'assistant_manager', 'team_lead'],
  'field-management': ['admin', 'manager', 'assistant_manager'],
  settings: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  'branch-management': ['admin'],
  'audit-logs': ['admin'],
  mock: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  'assessment-support': ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  'interview-support': ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  hierarchy: ['admin', 'manager', 'assistant_manager'],
  'work-queue': ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent'],
  reports: ['admin', 'manager', 'assistant_manager'],
  'coaching-notes': ['admin', 'manager', 'assistant_manager', 'team_lead'],
  'review-queue': ['admin', 'manager', 'assistant_manager', 'team_lead'],
  notifications: ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent', 'lead_generation'],
  attendance: ['admin', 'manager', 'assistant_manager', 'team_lead'],
  'linkedin-requests': ['agent'],
  'linkedin-account-management': ['admin', 'team_lead'],
  'linkedin-reports': ['admin', 'team_lead'],
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
