'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';

interface ProtectedRouteProps {
  children: React.ReactNode;
  componentKey: ComponentKey;
  fallbackPath?: string;
}

export function ProtectedRoute({
  children,
  componentKey,
  fallbackPath = '/dashboard'
}: ProtectedRouteProps) {
  const { user } = useAuth();
  const { canAccess, isLoading } = useAccess();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      // Not authenticated, redirect to login
      router.push('/login');
      return;
    }

    if (!isLoading && !canAccess(componentKey)) {
      // Not authorized, redirect to fallback
      router.push(fallbackPath);

      // Show toast notification (we'll implement toast later)
      console.warn(`Access denied to ${componentKey}`);
    }
  }, [user, canAccess, componentKey, isLoading, router, fallbackPath]);

  // Show loading state while checking permissions
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated or not authorized
  if (!user || !canAccess(componentKey)) {
    return null;
  }

  return <>{children}</>;
}
