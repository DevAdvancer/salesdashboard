import type { ComponentKey, UserRole } from '@/lib/types';

type RoleAccessMap = Record<ComponentKey, readonly UserRole[]>;

export const COMPONENT_ACCESS: RoleAccessMap = {
  dashboard: ['admin', 'developer', 'monitor', 'team_lead', 'agent', 'lead_generation'],
  chat: ['admin', 'developer', 'monitor', 'team_lead', 'agent', 'lead_generation'],
  leads: ['admin', 'developer', 'monitor', 'team_lead', 'agent', 'lead_generation'],
  history: ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  'user-management': ['admin', 'developer', 'monitor', 'team_lead'],
  'field-management': [],
  settings: ['admin', 'developer', 'monitor', 'team_lead', 'agent', 'lead_generation'],
  'branch-management': ['admin', 'developer', 'monitor'],
  'audit-logs': ['admin', 'developer', 'monitor'],
  mock: ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  'assessment-support': ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  'interview-support': ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  hierarchy: ['admin', 'developer', 'monitor'],
  'work-queue': ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  reports: ['admin', 'developer', 'monitor', 'team_lead', 'agent'],
  'coaching-notes': ['admin', 'developer', 'monitor', 'team_lead'],
  'review-queue': ['admin', 'developer', 'monitor', 'team_lead'],
  notifications: ['admin', 'developer', 'monitor', 'team_lead', 'agent', 'lead_generation'],
  attendance: ['admin', 'developer', 'monitor', 'team_lead'],
  'lead-requests': ['admin', 'developer', 'monitor'],
  'linkedin-requests': ['agent', 'lead_generation'],
  'linkedin-account-management': ['admin', 'developer', 'monitor', 'team_lead'],
  'linkedin-reports': ['admin', 'developer', 'monitor', 'team_lead'],
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
