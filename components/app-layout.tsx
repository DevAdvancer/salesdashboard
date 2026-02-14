'use client';

import { Navigation } from './navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

const PUBLIC_ROUTES = ['/login'];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      router.push('/login');
    }
  }, [user, loading, isPublicRoute, router]);

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  // Public routes don't need navigation
  if (isPublicRoute || !user) {
    return <>{children}</>;
  }

  // Authenticated routes with navigation
  return (
    <div className="flex min-h-screen">
      <Navigation />
      <main className="flex-1 lg:ml-64 p-4 pt-16 sm:p-6 sm:pt-16 lg:p-8 lg:pt-8">{children}</main>
    </div>
  );
}
