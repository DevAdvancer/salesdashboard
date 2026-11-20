'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { isRoleEligibleForComponent } from '@/lib/constants/component-access';

export function useLinkedinConversationAccess(checkAccess = true) {
  const { user, serverSessionReady } = useAuth();
  const eligible = checkAccess && user && user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-conversations', user.role);
  if (!eligible) return false;
  return serverSessionReady ? true : null;
}
