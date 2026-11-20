'use client';

import { useEffect, useState } from 'react';
import { isLinkedinConversationReleased, LINKEDIN_CONVERSATION_RELEASE_AT } from '@/lib/utils/linkedin-conversation-release';

export function useLinkedinConversationRelease() {
  const [released, setReleased] = useState(false);
  useEffect(() => {
    const check = () => setReleased(isLinkedinConversationReleased());
    check();
    const remaining = Date.parse(LINKEDIN_CONVERSATION_RELEASE_AT) - Date.now();
    const timer = remaining > 0 ? window.setTimeout(check, Math.min(remaining, 2_147_483_647)) : undefined;
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  return released;
}
