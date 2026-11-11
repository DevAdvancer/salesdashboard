'use client';

import { useEffect, useState } from 'react';
import { getMyLinkedinConversationAccessAction } from '@/app/actions/beta';
import { useAuth } from '@/lib/contexts/auth-context';
import { isRoleEligibleForComponent } from '@/lib/constants/component-access';

export function useLinkedinConversationAccess() {
  const { user, serverSessionReady } = useAuth();
  const userId = user && user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-conversations', user.role) ? user.$id : null;
  const [result, setResult] = useState<{ userId: string; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!userId || !serverSessionReady) return;
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
  }, [userId, serverSessionReady]);
  if (!userId) return false;
  return serverSessionReady && result?.userId === userId ? result.enabled : null;
}
