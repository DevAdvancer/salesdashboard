'use client';

import { Navigation } from './navigation';
import { WhatsNewModal } from './whats-new-modal';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const PUBLIC_ROUTES = ['/login'];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) router.push('/login');
  }, [user, loading, isPublicRoute, router]);

  if (loading) {
    return (
      <div className="loading-container">
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '2.25rem', height: '2.25rem', borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--terracotta)',
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
