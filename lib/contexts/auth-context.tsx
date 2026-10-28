'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { User, UserRole, Department, AuthContext as AuthContextType } from '@/lib/types';
import { deleteAppwritePresence } from '@/lib/utils/appwrite-presences';
import { clearBrowserQueryClient } from '@/lib/queries/client';
import { MAINTENANCE_MANAGER_EMAIL, MAINTENANCE_MANAGER_USER_ID } from '@/lib/constants/maintenance';
import { withClientTimeout } from '@/lib/utils/client-timeout';

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SERVER_SESSION_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const SERVER_SESSION_SYNC_STORAGE_KEY = 'crm.lastServerSessionSyncAt';
const ACTIVE_DASHBOARD_STORAGE_KEY = 'crm.activeDashboard';
type SessionBootstrap = { user: Record<string, unknown> & { $id: string }; status: NonNullable<AuthContextType['initialAccess']>['status'] };

/**
 * Leadership roles (admin/developer/monitor/operations) can preview either
 * dashboard from a single login. The rest are pinned to their assigned
 * department. The active view is persisted in localStorage so it survives
 * refresh; for non-leadership users it's always derived from user.department.
 */
function canSwitchDashboard(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'developer' || role === 'monitor' || role === 'operations';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Flips to true the first time syncServerSession settles (success or
  // failure) for the current session. Reset by logout/clearServerSession
  // and at the start of every checkSession so a re-login re-gates.
  // Pages that fire server actions from useEffect should wait on this
  // flag to avoid a 500 race on the crm_appwrite_jwt cookie.
  const [serverSessionReady, setServerSessionReady] = useState(false);
  const [nativeMfaPending, setNativeMfaPending] = useState(false);
  const [initialAccess, setInitialAccess] = useState<AuthContextType['initialAccess']>(null);
  const [sessionRestoreError, setSessionRestoreError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retrySessionRestore = useCallback(() => setRestoreAttempt(attempt => attempt + 1), []);
  // Sales-team members and resume-team members are pinned; only leadership
  // roles may flip this. We store it in state for re-render, but read the
  // initial value from localStorage so the choice survives a refresh.
  const [activeDashboard, setActiveDashboardState] = useState<Department>(() => {
    if (typeof window === 'undefined') return 'sales';
    try { return window.localStorage.getItem(ACTIVE_DASHBOARD_STORAGE_KEY) === 'resume' ? 'resume' : 'sales'; }
    catch { return 'sales'; }
  });
  const lastServerSessionSyncAt = useRef(0);
  const serverSessionSyncPromise = useRef<Promise<SessionBootstrap | null> | null>(null);

  const readStoredServerSessionSyncAt = useCallback(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    try { return Number(window.sessionStorage.getItem(SERVER_SESSION_SYNC_STORAGE_KEY) || 0); }
    catch { return 0; }
  }, []);

  const writeStoredServerSessionSyncAt = useCallback((value: number) => {
    if (typeof window === 'undefined') {
      return;
    }

    try { window.sessionStorage.setItem(SERVER_SESSION_SYNC_STORAGE_KEY, String(value)); }
    catch { /* The in-memory cooldown still works when storage is unavailable. */ }
  }, []);

  const syncServerSession = useCallback(async ({ force = false, bootstrap = false, signal: parentSignal }: { force?: boolean; bootstrap?: boolean; signal?: AbortSignal } = {}) => {
    const now = Date.now();
    const lastSyncedAt = Math.max(lastServerSessionSyncAt.current, readStoredServerSessionSyncAt());
    if (!force && now - lastSyncedAt < SERVER_SESSION_SYNC_COOLDOWN_MS) {
      return serverSessionSyncPromise.current ?? Promise.resolve(null);
    }

    if (serverSessionSyncPromise.current) {
      return serverSessionSyncPromise.current;
    }

    serverSessionSyncPromise.current = withClientTimeout(async signal => {
      const jwt = await account.createJWT();
      if (signal.aborted) throw new Error('Session restoration timed out. Please retry.');
      const response = await fetch('/api/auth/appwrite-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jwt: jwt.jwt, ...(bootstrap ? { bootstrap: true } : {}) }),
        signal,
      });
      if (!response.ok) throw new Error('Failed to sync server session');
      const data = bootstrap ? await response.json() : null;
      if (signal.aborted) throw new Error('Session restoration timed out. Please retry.');
      const syncedAt = Date.now();
      lastServerSessionSyncAt.current = syncedAt;
      writeStoredServerSessionSyncAt(syncedAt);
      if (!bootstrap) return null;
      return data.user?.$id && data.status?.state ? data as SessionBootstrap : null;
    }, 12_000, 'Session restoration timed out. Please retry.', parentSignal).finally(() => { serverSessionSyncPromise.current = null; });

    return serverSessionSyncPromise.current;
  }, [readStoredServerSessionSyncAt, writeStoredServerSessionSyncAt]);

  const clearServerSession = useCallback(async () => {
    lastServerSessionSyncAt.current = 0;
    writeStoredServerSessionSyncAt(0);
    setServerSessionReady(false);
    setInitialAccess(null);
    await withClientTimeout(signal => fetch('/api/auth/appwrite-session', { method: 'DELETE', signal }),
      6_000, 'Session cleanup timed out.').catch(() => {});
  }, [writeStoredServerSessionSyncAt]);

  const recoverServerSession = useCallback(async () => {
    // Force bypasses the cooldown after an idle tab's 15-minute cookie expires.
    // In-flight rotation is still shared with the focus/background refresh.
    await syncServerSession({ force: true });
    window.dispatchEvent(new Event('crm-session-restored'));
  }, [syncServerSession]);

  // Fetch user document from database
  const fetchUserDocument = useCallback(async (userId: string, initialDocument?: Record<string, unknown>): Promise<User | null> => {
    try {
      const userDoc = (initialDocument || await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        userId
      )) as Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string };

      const userData = {
        $id: userDoc.$id,
        name: userDoc.name as string,
        email: userDoc.email as string,
        role: userDoc.role as UserRole,
        department: ((userDoc.department as Department) ?? 'sales') as Department,
        teamLeadId: (userDoc.teamLeadId as string) || null,
        branchIds: Array.isArray(userDoc.branchIds) ? (userDoc.branchIds as string[]) : [],
        primaryBranchId: typeof userDoc.primaryBranchId === 'string' ? userDoc.primaryBranchId : null,
        notificationsEnabled: userDoc.notificationsEnabled !== false,
        notificationEmails: (userDoc.notificationEmails as string) || '',
        isActive: userDoc.isActive !== false,
        branchId: (userDoc.branchId as string) || null,
        $createdAt: userDoc.$createdAt,
        $updatedAt: userDoc.$updatedAt,
      };

      return userData;
    } catch (error) {
      console.error('Error fetching user document:', error);
      return null;
    }
  }, []);

  const bootstrapSession = useCallback(async (parentSignal?: AbortSignal) => {
    return withClientTimeout(async signal => {
      const response = await fetch('/api/security/access?view=bootstrap', { cache: 'no-store', signal });
      if (response.status === 401 || response.status === 404) return null;
      if (!response.ok) throw new Error('Could not restore the CRM session. Please retry.');
      const data = await response.json();
      return data.user?.$id && data.status?.state ? data as SessionBootstrap : null;
    }, 8_000, 'Session restoration timed out. Please retry.', parentSignal);
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    let cancelled = false;
    const restoreAbort = new AbortController();
    const deadline = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      restoreAbort.abort();
      setSessionRestoreError('Loading your session took too long. Please retry; you do not need to refresh the page.');
      setUser(null); setServerSessionReady(false); setLoading(false);
    }, 20_000);

    const checkSession = async () => {
      // Re-gate: a re-login or session restore must wait for the next sync
      // attempt before downstream pages fire server actions.
      setServerSessionReady(false);
      setSessionRestoreError('');
      setNativeMfaPending(false);
      setLoading(true);
      try {
        // A valid HttpOnly session can restore profile and access in one request.
        // JWT rotation is background work, rather than a prerequisite on every refresh.
        const restored = await bootstrapSession(restoreAbort.signal).catch(() => null);
        if (cancelled) return;
        if (restored) {
          const restoredUser = await fetchUserDocument(restored.user.$id, restored.user);
          if (cancelled) return;
          setUser(restoredUser);
          setInitialAccess({ userId: restored.user.$id, status: restored.status });
          setServerSessionReady(true);
          void syncServerSession().catch(() => {});
          return;
        }
        const session = await withClientTimeout(() => account.get(), 8_000, 'Could not restore the session. Please retry.', restoreAbort.signal);
        if (cancelled) return;
        if (session) {
          const maintenance = await withClientTimeout(async signal => {
            const response = await fetch('/api/maintenance/status', { cache: 'no-store', signal });
            return response.ok ? await response.json() as { active?: boolean } : null;
          }, 4_000, 'Could not check maintenance status. Please retry.', restoreAbort.signal);
          if (cancelled) return;
          if (maintenance) {
            if (maintenance.active && (session.$id !== MAINTENANCE_MANAGER_USER_ID ||
              session.email?.trim().toLowerCase() !== MAINTENANCE_MANAGER_EMAIL)) {
              // Clear only this site's CRM cookie, not the cross-site Appwrite session.
              await clearServerSession();
              if (!cancelled) setUser(null);
              return;
            }
          }
          // The own-profile gateway needs the server JWT before its bootstrap read.
          const refreshed = await syncServerSession({ force: true, bootstrap: true, signal: restoreAbort.signal });
          if (cancelled) return;
          const userDoc = await fetchUserDocument(session.$id, refreshed?.user);
          if (refreshed && !cancelled) setInitialAccess({ userId: refreshed.user.$id, status: refreshed.status });
          if (cancelled) return;

          if (userDoc?.isActive === false) {
            await account.deleteSession('current').catch(() => {});
            if (cancelled) return;
            await clearServerSession();
            if (!cancelled) setUser(null);
            return;
          }
          if (!userDoc) {
            throw new Error('Could not load the user profile. Please retry.');
          }
          const nextUser = userDoc;
          setUser((prev) => {
            // Skip re-render when the session restore yields the same user
            // doc we already have. Cheap shallow equality: the provider
            // always rebuilds the user object from Appwrite on every
            // checkSession, so prev vs new is reference-equal only if
            // the user object was already correct.
            if (
              prev &&
              prev.$id === nextUser.$id &&
              prev.email === nextUser.email &&
              prev.role === nextUser.role &&
              prev.department === nextUser.department &&
              prev.isActive === nextUser.isActive &&
              prev.teamLeadId === nextUser.teamLeadId &&
              prev.branchId === nextUser.branchId &&
              prev.$updatedAt === nextUser.$updatedAt
            ) {
              return prev;
            }
            return nextUser;
          });
          // Un-gate: the syncServerSession promise has settled (success or
          // catch), and the user is in place. Pages may now fire server
          // actions without racing the crm_appwrite_jwt cookie write.
          if (!cancelled) setServerSessionReady(true);
        } else {
          // account.get() returned nothing — no session to sync, no gate needed.
          if (!cancelled) setServerSessionReady(true);
        }
      } catch (error) {
        if (cancelled) return;
        if ((error as { type?: string })?.type === 'user_more_factors_required') {
          setUser(null); setInitialAccess(null); setNativeMfaPending(true);
        } else if ((error as { code?: number })?.code === 401) {
          // Only a confirmed native session expiry clears the server bridge.
          await clearServerSession();
          if (!cancelled) { setUser(null); setServerSessionReady(true); }
        } else {
          setUser(null);
          setSessionRestoreError('Could not load your session. Retry to continue without refreshing the page.');
        }
      } finally {
        window.clearTimeout(deadline);
        if (!cancelled) setLoading(false);
      }
    };

    checkSession();

    return () => {
      cancelled = true;
      restoreAbort.abort();
      window.clearTimeout(deadline);
    };
  }, [bootstrapSession, clearServerSession, fetchUserDocument, syncServerSession, restoreAttempt]);

  useEffect(() => {
    if (!user) return;

    const refreshServerSession = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      syncServerSession().catch((error) => {
        console.error('Failed to refresh server session:', error);
      });
    };

    const intervalId = window.setInterval(refreshServerSession, 10 * 60 * 1000);
    window.addEventListener('focus', refreshServerSession);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshServerSession);
    };
  }, [syncServerSession, user]);

  // Login function
  const login = useCallback(async (email: string, password: string) => {
    let createdSession = false;
    try {
      const maintenanceResponse = await fetch('/api/maintenance/status', { cache: 'no-store' });
      if (maintenanceResponse.ok) {
        const maintenance = await maintenanceResponse.json() as { active?: boolean };
        if (maintenance.active && email.trim().toLowerCase() !== MAINTENANCE_MANAGER_EMAIL) {
          throw new Error('CRM maintenance is in progress. Try again after the scheduled end time.');
        }
      }
      // Re-gate for the new session.
      setServerSessionReady(false);
      setInitialAccess(null);
      setNativeMfaPending(false);

      // Discard any previous account's bridge before creating a new session.
      await serverSessionSyncPromise.current?.catch(() => {});
      await clearServerSession();
      const created = await account.createEmailPasswordSession(email, password);
      createdSession = true;
      // Appwrite keeps a password session while requiring its second factor.
      // Do not attempt JWT bootstrap or delete that pending session.
      const signedInAccount = await account.get();

      const restored = await syncServerSession({ force: true, bootstrap: true });
      const accountId = restored?.user.$id || created?.userId || signedInAccount.$id;
      const userDoc = await fetchUserDocument(accountId, restored?.user);

      if (!userDoc) {
        throw new Error('User document not found');
      }

      if (userDoc.isActive === false) {
        await account.deleteSession('current').catch(() => {});
        await clearServerSession();
        throw new Error('This account is inactive. Please contact an administrator.');
      }

      setUser(userDoc);
      setSessionRestoreError('');
      if (restored) setInitialAccess({ userId: userDoc.$id, status: restored.status });
      // Un-gate: the JWT cookie is now set; downstream pages may fire.
      setServerSessionReady(true);
      // Return the resolved doc so callers can route by department immediately
      // (state updates are async — reading `user` right after login is stale).
      return userDoc;
    } catch (error) {
      if ((error as { type?: string })?.type === 'user_more_factors_required') {
        setUser(null); setInitialAccess(null); setNativeMfaPending(true); setSessionRestoreError('');
        return null;
      }
      console.error('Login error:', error);
      if (createdSession) {
        try { await account.deleteSession('current'); } catch { /* Session may already be gone. */ }
        await clearServerSession();
      }
      // On login failure we still un-gate (with a false user) so protected
      // pages can render the unauthenticated state without hanging.
      setServerSessionReady(true);
      throw error;
    }
  }, [clearServerSession, fetchUserDocument, syncServerSession]);

  // Logout function
  const logout = useCallback(async () => {
    try {
      if (user?.$id) {
        await deleteAppwritePresence({ presenceId: user.$id }).catch(() => {});
      }
      await account.deleteSession('current').catch(() => {});
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      await clearServerSession();
      databases.clearReadCache?.();
      clearBrowserQueryClient();
      setUser(null); setNativeMfaPending(false);
    }
  }, [clearServerSession, user]);

  const signup = useCallback(async () => {
    throw new Error('Signup is disabled. Ask an admin to create the user account.');
  }, []);

  // Role-based helper properties
  const isAdmin = user?.role === 'admin' || user?.role === 'developer';
  const isDeveloper = user?.role === 'developer';
  const isTeamLead = user?.role === 'team_lead';
  const isSeniorTL = user?.role === 'senior_tl';
  const isAgent = user?.role === 'agent';
  const isLeadGeneration = user?.role === 'lead_generation';
  const isMonitor = user?.role === 'monitor';
  const isOperations = user?.role === 'operations';
  const canSwitchDashboardFlag = canSwitchDashboard(user?.role);

  // Non-leadership users are pinned to their own department. Leadership users
  // (admin/developer/monitor/operations) can preview either dashboard from a
  // single login, so isResumeTeam / isSalesTeam follow the active view.
  const effectiveDepartment: Department =
    canSwitchDashboardFlag && user
      ? activeDashboard
      : (user?.department ?? 'sales');

  const isResumeTeam = effectiveDepartment === 'resume';
  const isSalesTeam = !isResumeTeam;
  const canManageAttendance = user?.role === 'admin' || user?.role === 'operations';

  // Setter for the active dashboard. Persists to localStorage so the choice
  // survives a refresh. No-op for non-leadership users so a stale localStorage
  // value from a previously-admin account can't leak into a non-admin login.
  const setActiveDashboard = useCallback((next: Department) => {
    if (!canSwitchDashboardFlag) return;
    setActiveDashboardState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_DASHBOARD_STORAGE_KEY, next);
    }
  }, [canSwitchDashboardFlag]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAdmin,
      isDeveloper,
      isTeamLead,
      isSeniorTL,
      isAgent,
      isLeadGeneration,
      isMonitor,
      isOperations,
      isResumeTeam,
      isSalesTeam,
      canManageAttendance,
      activeDashboard: effectiveDepartment,
      canSwitchDashboard: canSwitchDashboardFlag,
      setActiveDashboard,
      loading,
      serverSessionReady,
      recoverServerSession,
      sessionRestoreError,
      retrySessionRestore,
      initialAccess,
      nativeMfaPending,
      login,
      logout,
      signup,
    }),
    [
      user,
      isAdmin,
      isDeveloper,
      isTeamLead,
      isSeniorTL,
      isAgent,
      isLeadGeneration,
      isMonitor,
      isOperations,
      isResumeTeam,
      isSalesTeam,
      canManageAttendance,
      effectiveDepartment,
      canSwitchDashboardFlag,
      setActiveDashboard,
      loading,
      serverSessionReady,
      recoverServerSession,
      sessionRestoreError,
      retrySessionRestore,
      initialAccess,
      nativeMfaPending,
      login,
      logout,
      signup,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook to use auth context
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
