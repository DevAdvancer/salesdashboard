'use client';

import { useEffect, useState } from 'react';
import { getMyLinkedinConversationAccessAction } from '@/app/actions/beta';
import { useAuth } from '@/lib/contexts/auth-context';
import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { useLinkedinConversationRelease } from '@/lib/hooks/use-linkedin-conversation-release';

export function useLinkedinConversationAccess(checkAccess = true) {
  const { user, serverSessionReady } = useAuth();
  const released = useLinkedinConversationRelease();
  const userId = checkAccess && user && user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-conversations', user.role) ? user.$id : null;
  const [result, setResult] = useState<{ userId: string; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!userId || !serverSessionReady || released) return;
    let cancelled = false;
    function check() {
      void getMyLinkedinConversationAccessAction().then(enabled => {
        if (!cancelled) setResult({ userId: userId!, enabled });
      }).catch(() => {
        if (!cancelled) setResult({ userId: userId!, enabled: false });
      });
    }
    check();
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.removeEventListener('focus', check); };
  }, [userId, serverSessionReady, released]);
  if (!userId) return false;
  if (released && serverSessionReady) return true;
  return serverSessionReady && result?.userId === userId ? result.enabled : null;
}
