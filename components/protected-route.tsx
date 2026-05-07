'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import { handlePermissionError } from '@/lib/utils/error-handler';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
      handlePermissionError(
        `You don't have permission to access ${componentKey.replace('-', ' ')}`,
        { showToast: true }
      );
      router.push(fallbackPath);
    }
  }, [user, canAccess, componentKey, isLoading, router, fallbackPath]);

  // Show loading state while checking permissions
  if (isLoading) {
    return (
      <div className="container mx-auto space-y-6">
        <div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-3 h-4 w-80" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="mt-3 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
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
