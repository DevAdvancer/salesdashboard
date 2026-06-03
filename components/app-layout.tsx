'use client';

import { Navigation } from './navigation';
import { WhatsNewModal } from './whats-new-modal';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import {
  checkAndNotifyAdminAttendanceEscalationsAction,
  markAttendancePresenceAction,
} from '@/app/actions/attendance';
import { upsertAppwritePresence } from '@/lib/utils/appwrite-presences';
import { AttendanceSelfToggle } from '@/components/attendance-self-toggle';

const PUBLIC_ROUTES = ['/login', '/referral'];
const ADMIN_ATTENDANCE_PING_COOLDOWN_MS = 30 * 60 * 1000;
const ADMIN_ATTENDANCE_PING_STORAGE_KEY = 'crm:last-admin-attendance-ping-at';
const PRESENCE_PING_COOLDOWN_MS = 60 * 1000;
const PRESENCE_PING_STORAGE_KEY = 'crm:last-attendance-presence-ping-at';
const PRESENCE_EXPIRES_AFTER_MS = 5 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 2 * 60 * 1000;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const showAttendanceToggle = pathname === '/dashboard';
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const lastRedirectPath = useRef<string | null>(null);
  const lastAttendancePingAt = useRef(0);
  const lastPresencePingAt = useRef(0);

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

  useEffect(() => {
    if (!user || isPublicRoute) return;
    if (user.role !== 'admin') return;

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

  useEffect(() => {
    if (!user || isPublicRoute) return;

    const ping = async () => {
      const now = Date.now();
      const storedLastPingAt = Number(
        window.sessionStorage.getItem(PRESENCE_PING_STORAGE_KEY) || 0
      );
      const lastPingAt = Math.max(lastPresencePingAt.current, storedLastPingAt);
      if (now - lastPingAt < PRESENCE_PING_COOLDOWN_MS) return;

      lastPresencePingAt.current = now;
      window.sessionStorage.setItem(PRESENCE_PING_STORAGE_KEY, String(now));

      const expiresAt = new Date(Date.now() + PRESENCE_EXPIRES_AFTER_MS).toISOString();
      await upsertAppwritePresence({
        presenceId: user.$id,
        status: 'online',
        metadata: { path: pathname },
        expiresAt,
      }).catch(() => {});

      await markAttendancePresenceAction({
        currentUserId: user.$id,
        path: pathname,
      }).catch(() => {});
    };

    const intervalId = window.setInterval(() => {
      ping().catch(() => {});
    }, PRESENCE_HEARTBEAT_MS);

    window.addEventListener('focus', ping);
    void ping();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', ping);
    };
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
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
      <Navigation
        isCollapsed={isSidebarCollapsed}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      {showAttendanceToggle ? <AttendanceSelfToggle /> : null}
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
