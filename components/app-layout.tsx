'use client';

import { Navigation } from './navigation';
import { SecurityNotice } from './security-notice';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { checkAndNotifyAdminAttendanceEscalationsAction } from '@/app/actions/attendance/notifications';
import { LoaderOverlay } from '@/components/loader/LoaderOverlay';
import { MAINTENANCE_MANAGER_EMAIL, MAINTENANCE_MANAGER_USER_ID } from '@/lib/constants/maintenance';

const PUBLIC_ROUTES = ['/login', '/referral', '/maintenance'];
const ADMIN_ATTENDANCE_PING_COOLDOWN_MS = 30 * 60 * 1000;
const ADMIN_ATTENDANCE_PING_STORAGE_KEY = 'crm:last-admin-attendance-ping-at';


import { useUIStore } from '@/lib/hooks/useUIStore';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, activeDashboard } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const { isSidebarCollapsed, setSidebarCollapsed } = useUIStore();
  const lastRedirectPath = useRef<string | null>(null);
  const lastAttendancePingAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    const checkMaintenance = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch('/api/maintenance/status', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const status = await response.json() as { active: boolean };
        if (cancelled) return;
        const manager = user?.$id === MAINTENANCE_MANAGER_USER_ID &&
          user.email.toLowerCase() === MAINTENANCE_MANAGER_EMAIL && user.role === 'admin';
        if (status.active && !manager) {
          // Keep the shared Appwrite session intact for other origins such as localhost.
          if (!cancelled && pathname !== '/maintenance') router.replace('/maintenance');
        } else if (!status.active && pathname === '/maintenance') {
          router.replace(user ? '/dashboard' : '/login');
        }
      } catch {
        // A temporary status error should not force a logout.
      } finally {
        checking = false;
      }
    };
    void checkMaintenance();
    const interval = window.setInterval(checkMaintenance, 10_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [pathname, router, user]);

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
        onCollapsedChange={setSidebarCollapsed}
      />
      <main
        className="relative flex-1 p-6 pt-20 transition-[margin] duration-300 sm:p-8 sm:pt-20 lg:p-10 lg:pt-10 lg:ml-64"
        style={{ minWidth: 0 }}
      >
        <LoaderOverlay />
        {children}
        <SecurityNotice />
      </main>
    </div>
  );
}
