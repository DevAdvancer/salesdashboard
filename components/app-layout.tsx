'use client';

import { Navigation } from './navigation';
import { WhatsNewModal } from './whats-new-modal';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { checkAndNotifyAdminAttendanceEscalationsAction } from '@/app/actions/attendance/notifications';
import { LoaderOverlay } from '@/components/loader/LoaderOverlay';

const PUBLIC_ROUTES = ['/login', '/referral'];
const ADMIN_ATTENDANCE_PING_COOLDOWN_MS = 30 * 60 * 1000;
const ADMIN_ATTENDANCE_PING_STORAGE_KEY = 'crm:last-admin-attendance-ping-at';


export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, activeDashboard } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const lastRedirectPath = useRef<string | null>(null);
  const lastAttendancePingAt = useRef(0);

  useEffect(() => {
    // Post-login landing page depends on the user's active dashboard. Resume-
    // department users (and leadership previewing the resume view) land on
    // /resume-dashboard, which they can access; /dashboard is a sales-only
    // route and would trip ProtectedRoute's permission guard for them.
    const homePath = activeDashboard === 'resume' ? '/resume-dashboard' : '/dashboard';

    // Reset redirect tracking if we've successfully navigated
    if (lastRedirectPath.current && lastRedirectPath.current !== pathname) {
      // We haven't reached the destination yet, don't reset
      if (
        (lastRedirectPath.current === '/login' && pathname !== '/login') ||
        (lastRedirectPath.current === homePath && pathname !== homePath)
      ) {
         // wait for it
      } else {
         lastRedirectPath.current = null;
      }
    }

    if (!loading && !user && !isPublicRoute && lastRedirectPath.current !== '/login') {
      lastRedirectPath.current = '/login';
      router.replace('/login');
    } else if (!loading && user && pathname === '/login' && lastRedirectPath.current !== homePath) {
      lastRedirectPath.current = homePath;
      router.replace(homePath);
    }
  }, [user, loading, isPublicRoute, pathname, router, activeDashboard]);

  useEffect(() => {
    if (!user || isPublicRoute) return;
    if (user.role !== 'admin' && user.role !== 'operations') return;

    const now = Date.now();
    const storedLastPingAt = Number(
      window.sessionStorage.getItem(ADMIN_ATTENDANCE_PING_STORAGE_KEY) || 0
    );
    const lastPingAt = Math.max(lastAttendancePingAt.current, storedLastPingAt);
    if (now - lastPingAt < ADMIN_ATTENDANCE_PING_COOLDOWN_MS) return;

    lastAttendancePingAt.current = now;
    window.sessionStorage.setItem(ADMIN_ATTENDANCE_PING_STORAGE_KEY, String(now));

    checkAndNotifyAdminAttendanceEscalationsAction({ currentUserId: user.$id }).catch(() => {});
  }, [isPublicRoute, pathname, user]);



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
    <div className="flex min-h-screen relative overflow-hidden bg-background">
      {/* Ambient Background Mesh */}
      <div className="absolute top-[-10%] right-[-5%] -z-10 w-[70vw] h-[70vw] max-w-[800px] max-h-[800px] rounded-full opacity-[0.08] dark:opacity-[0.04] bg-[radial-gradient(circle_at_center,_var(--info)_0%,_transparent_60%)] blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] -z-10 w-[60vw] h-[60vw] max-w-[600px] max-h-[600px] rounded-full opacity-[0.05] dark:opacity-[0.03] bg-[radial-gradient(circle_at_center,_var(--accent-purple)_0%,_transparent_60%)] blur-[100px] pointer-events-none" />
      
      <Navigation
        isCollapsed={isSidebarCollapsed}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      <main
        className={`relative flex-1 p-6 pt-20 transition-[margin] duration-300 sm:p-8 sm:pt-20 lg:p-10 lg:pt-10 ${isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}
        style={{ minWidth: 0 }}
      >
        <LoaderOverlay />
        {children}
      </main>
    </div>
  );
}
