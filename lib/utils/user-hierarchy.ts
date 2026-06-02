import { UserRole } from '@/lib/types';

export const BOOTSTRAP_ADMIN_EMAIL = 'abhirupvizva@gmail.com';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getSignupRoleForEmail(email: string): UserRole {
  return normalizeEmail(email) === BOOTSTRAP_ADMIN_EMAIL ? 'admin' : 'manager';
}

export function canCreateManagerlessTeamLead(params: {
  callerRole: UserRole;
  managerIds?: string[];
}): boolean {
  return (params.callerRole === 'admin' || params.callerRole === 'developer') && (params.managerIds?.length ?? 0) === 0;
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
  let managerIds: string[] = [];
  const assistantManagerIds = [...(params.inputAssistantManagerIds ?? [])];

  if (params.inputAssistantManagerId && !assistantManagerIds.includes(params.inputAssistantManagerId)) {
    assistantManagerIds.push(params.inputAssistantManagerId);
  }

  if (params.callerRole === 'manager') {
    managerIds = [params.callerId];
  } else if (params.callerRole === 'assistant_manager') {
    const callerManagerIds = params.callerManagerIds?.length
      ? params.callerManagerIds
      : params.callerManagerId
        ? [params.callerManagerId]
        : [];
    managerIds = [...callerManagerIds, params.callerId];
    if (!assistantManagerIds.includes(params.callerId)) {
      assistantManagerIds.push(params.callerId);
    }
  } else if (params.inputManagerIds && Array.isArray(params.inputManagerIds)) {
    managerIds = [...params.inputManagerIds];
  }

  assistantManagerIds.forEach((amId) => {
    if (!managerIds.includes(amId)) {
      managerIds.push(amId);
    }
  });

  return {
    managerIds,
    managerId: managerIds[0] ?? null,
    assistantManagerIds,
  };
}
