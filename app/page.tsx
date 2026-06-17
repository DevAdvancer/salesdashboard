'use client';

import { useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';

// Use a module-level variable to prevent double redirection in React Strict Mode
// and to ensure we don't try to exchange the same code twice if the user navigates back.
let isRedirecting = false;

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, activeDashboard } = useAuth();
  const code = searchParams.get('code');
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (code) {
      if (!isRedirecting) {
        isRedirecting = true;
        window.location.href = `/api/auth/callback?code=${code}`;
      }
      return;
    }

    if (!loading && !hasRedirected.current) {
      hasRedirected.current = true;
      if (user) {
        // activeDashboard respects user.department for non-leadership users
        // and the user's in-app choice for leadership roles (admin/developer/
        // monitor/operations). So a single source of truth here is enough.
        const target = activeDashboard === 'resume' ? '/resume-dashboard' : '/dashboard';
        window.location.replace(target);
      } else {
        window.location.replace('/login');
      }
    }
  }, [user, loading, activeDashboard, router, code]);

  if (code) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Completing authentication...</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-lg">Loading...</p>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-lg">Loading...</p></div>}>
      <HomeContent />
    </Suspense>
  );
}
