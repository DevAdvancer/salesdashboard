'use client';

import { Navigation } from './navigation';
import { NotificationBell } from './notification-bell';
import { WhatsNewModal } from './whats-new-modal';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';

const PUBLIC_ROUTES = ['/login'];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const lastRedirectPath = useRef<string | null>(null);

  useEffect(() => {
    // Reset redirect tracking if we've successfully navigated
    if (lastRedirectPath.current && lastRedirectPath.current !== pathname) {
      // We haven't reached the destination yet, don't reset
      if (
        (lastRedirectPath.current === '/login' && pathname !== '/login') ||
        (lastRedirectPath.current === '/dashboard' && pathname !== '/dashboard')
      ) {
         // wait for it
      } else {
         lastRedirectPath.current = null;
      }
    }

    if (!loading && !user && !isPublicRoute && lastRedirectPath.current !== '/login') {
      lastRedirectPath.current = '/login';
      router.replace('/login');
    } else if (!loading && user && pathname === '/login' && lastRedirectPath.current !== '/dashboard') {
      lastRedirectPath.current = '/dashboard';
      router.replace('/dashboard');
    }
  }, [user, loading, isPublicRoute, pathname, router]);

  if (loading) {
    return (
      <div className="loading-container">
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '2.25rem', height: '2.25rem', borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--ink)',
            animation: 'spin 0.75s linear infinite',
            margin: '0 auto 1rem',
          }} />
          <p className="loading-text" style={{ margin: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (isPublicRoute || !user) return <>{children}</>;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
      <Navigation
        isCollapsed={isSidebarCollapsed}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      <NotificationBell />
      <main
        className={`flex-1 p-4 pt-16 transition-[margin] duration-300 sm:p-6 sm:pt-16 lg:p-8 lg:pt-8 ${isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}
        style={{ minWidth: 0 }}
      >
        {children}
      </main>
      <WhatsNewModal />
    </div>
  );
}
