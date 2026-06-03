import { UserRole } from '@/lib/types';

export const BOOTSTRAP_ADMIN_EMAIL = 'abhirupvizva@gmail.com';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getSignupRoleForEmail(email: string): UserRole {
  return 'admin';
}

export function canCreateManagerlessTeamLead(params: {
  callerRole: UserRole;
  managerIds?: string[];
}): boolean {
  return params.callerRole === 'admin' || params.callerRole === 'developer';
}

export function buildTeamLeadHierarchy(params: {
  callerRole: UserRole;
  callerId: string;
  callerManagerId?: string | null;
  callerManagerIds?: string[];
  inputManagerIds?: string[];
  inputAssistantManagerId?: string | null;
  inputAssistantManagerIds?: string[];
}) {
  return {
    managerIds: [],
    managerId: null,
    assistantManagerIds: [],
  };
}
