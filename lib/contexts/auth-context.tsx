'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { User, UserRole, Department, AuthContext as AuthContextType } from '@/lib/types';
import { deleteAppwritePresence } from '@/lib/utils/appwrite-presences';
import { clearBrowserQueryClient } from '@/lib/queries/client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SERVER_SESSION_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const SERVER_SESSION_SYNC_STORAGE_KEY = 'crm.lastServerSessionSyncAt';
const ACTIVE_DASHBOARD_STORAGE_KEY = 'crm.activeDashboard';

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
  // Sales-team members and resume-team members are pinned; only leadership
  // roles may flip this. We store it in state for re-render, but read the
  // initial value from localStorage so the choice survives a refresh.
  const [activeDashboard, setActiveDashboardState] = useState<Department>(() => {
    if (typeof window === 'undefined') return 'sales';
    const stored = window.localStorage.getItem(ACTIVE_DASHBOARD_STORAGE_KEY);
    return stored === 'resume' ? 'resume' : 'sales';
  });
  const lastServerSessionSyncAt = useRef(0);
  const serverSessionSyncPromise = useRef<Promise<void> | null>(null);

  const readStoredServerSessionSyncAt = useCallback(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    return Number(window.sessionStorage.getItem(SERVER_SESSION_SYNC_STORAGE_KEY) || 0);
  }, []);

  const writeStoredServerSessionSyncAt = useCallback((value: number) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(SERVER_SESSION_SYNC_STORAGE_KEY, String(value));
  }, []);

  const syncServerSession = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const now = Date.now();
    const lastSyncedAt = Math.max(lastServerSessionSyncAt.current, readStoredServerSessionSyncAt());
    if (!force && now - lastSyncedAt < SERVER_SESSION_SYNC_COOLDOWN_MS) {
      return serverSessionSyncPromise.current ?? Promise.resolve();
    }

    if (serverSessionSyncPromise.current) {
      return serverSessionSyncPromise.current;
    }

    const jwt = await account.createJWT();
    serverSessionSyncPromise.current = fetch('/api/auth/appwrite-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jwt: jwt.jwt }),
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to sync server session');
        }

        const syncedAt = Date.now();
        lastServerSessionSyncAt.current = syncedAt;
        writeStoredServerSessionSyncAt(syncedAt);
      })
      .finally(() => {
        serverSessionSyncPromise.current = null;
      });

    return serverSessionSyncPromise.current;
  }, [readStoredServerSessionSyncAt, writeStoredServerSessionSyncAt]);

  const clearServerSession = useCallback(async () => {
    lastServerSessionSyncAt.current = 0;
    writeStoredServerSessionSyncAt(0);
    setServerSessionReady(false);
    await fetch('/api/auth/appwrite-session', { method: 'DELETE' }).catch(() => {});
  }, [writeStoredServerSessionSyncAt]);

  // Fetch user document from database
  const fetchUserDocument = useCallback(async (userId: string): Promise<User | null> => {
    try {
      const userDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        userId
      );

      const userData = {
        $id: userDoc.$id,
        name: userDoc.name as string,
        email: userDoc.email as string,
        role: userDoc.role as UserRole,
        department: ((userDoc.department as Department) ?? 'sales') as Department,
        teamLeadId: (userDoc.teamLeadId as string) || null,
        branchIds: Array.isArray(userDoc.branchIds) ? (userDoc.branchIds as string[]) : [],
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

  // Check for existing session on mount
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      // Re-gate: a re-login or session restore must wait for the next sync
      // attempt before downstream pages fire server actions.
      setServerSessionReady(false);
      try {
        const session = await account.get();
        if (session) {
          // Parallelize: server session sync + user doc fetch both depend on
          // the local cookie already set by account.get(); no sequential order required.
          // We still need the sync promise to settle before un-gating the
          // context, so we await it here and only resolve the user-doc
          // branch via Promise.all with a no-op shim.
          const userDoc = await Promise.all([
            syncServerSession({ force: true }).catch(() => {}),
            fetchUserDocument(session.$id),
          ]).then(([, doc]) => doc);
          if (cancelled) return;

          if (userDoc?.isActive === false) {
            await account.deleteSession('current').catch(() => {});
            await clearServerSession();
            if (!cancelled) setUser(null);
            return;
          }
          if (!userDoc) {
            if (!cancelled) setUser(null);
            return;
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
      } catch {
        // No active session
        await clearServerSession();
        if (!cancelled) setUser(null);
        // No session, no actions should run anyway; flip the flag so consumers
        // can distinguish "still checking" from "checked, no session".
        if (!cancelled) setServerSessionReady(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [clearServerSession, fetchUserDocument, syncServerSession]);

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
    try {
      // Re-gate for the new session.
      setServerSessionReady(false);

      // Create email session
      await account.createEmailPasswordSession(email, password);

      // Get account details
      const accountDetails = await account.get();
      await syncServerSession({ force: true });

      // Fetch user document
      const userDoc = await fetchUserDocument(accountDetails.$id);

      if (!userDoc) {
        throw new Error('User document not found');
      }

      if (userDoc.isActive === false) {
        await account.deleteSession('current').catch(() => {});
        await clearServerSession();
        throw new Error('This account is inactive. Please contact an administrator.');
      }

      setUser(userDoc);
      // Un-gate: the JWT cookie is now set; downstream pages may fire.
      setServerSessionReady(true);
    } catch (error) {
      console.error('Login error:', error);
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
      await account.deleteSession('current');
      await clearServerSession();
      databases.clearReadCache?.();
      clearBrowserQueryClient();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }, [clearServerSession, user]);

  const signup = useCallback(async () => {
    throw new Error('Signup is disabled. Ask an admin to create the user account.');
  }, []);

  // Role-based helper properties
  const isAdmin = user?.role === 'admin' || user?.role === 'developer';
  const isDeveloper = user?.role === 'developer';
  const isTeamLead = user?.role === 'team_lead';
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
      login,
      logout,
      signup,
    }),
    [
      user,
      isAdmin,
      isDeveloper,
      isTeamLead,
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
