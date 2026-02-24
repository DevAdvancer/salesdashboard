'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';

// Use a module-level variable to prevent double redirection in React Strict Mode
// and to ensure we don't try to exchange the same code twice if the user navigates back.
let isRedirecting = false;

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const code = searchParams.get('code');

  useEffect(() => {
    if (code) {
      if (!isRedirecting) {
        isRedirecting = true;
        window.location.href = `/api/auth/callback?code=${code}`;
      }
      return;
    }

    if (!loading) {
      if (user) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    }
  }, [user, loading, router, code]);

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
