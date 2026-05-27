'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { User, UserRole, AuthContext as AuthContextType } from '@/lib/types';
import { getSignupRoleForEmail } from '@/lib/utils/user-hierarchy';
import { ID } from 'appwrite';

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SERVER_SESSION_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

function isSessionAlreadyExistsError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'type' in error &&
    error.code === 401 &&
    error.type === 'user_session_already_exists'
  );
}

function getErrorDetails(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const details = error as Record<string, unknown>;

    return {
      message: details.message,
      code: details.code,
      type: details.type,
      response: details.response,
    };
  }

  return { message: String(error) };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastServerSessionSyncAt = useRef(0);
  const serverSessionSyncPromise = useRef<Promise<void> | null>(null);

  const syncServerSession = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const now = Date.now();
    if (!force && now - lastServerSessionSyncAt.current < SERVER_SESSION_SYNC_COOLDOWN_MS) {
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

        lastServerSessionSyncAt.current = Date.now();
      })
      .finally(() => {
        serverSessionSyncPromise.current = null;
      });

    return serverSessionSyncPromise.current;
  }, []);

  const clearServerSession = useCallback(async () => {
    lastServerSessionSyncAt.current = 0;
    await fetch('/api/auth/appwrite-session', { method: 'DELETE' }).catch(() => {});
  }, []);

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
        managerId: userDoc.managerId as string | null,
        managerIds: Array.isArray(userDoc.managerIds) ? (userDoc.managerIds as string[]) : [],
        assistantManagerId: (userDoc.assistantManagerId as string) || null,
        assistantManagerIds: Array.isArray(userDoc.assistantManagerIds)
          ? (userDoc.assistantManagerIds as string[])
          : [],
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
    const checkSession = async () => {
      try {
        const session = await account.get();
        if (session) {
          await syncServerSession({ force: true });
          const userDoc = await fetchUserDocument(session.$id);
          if (userDoc?.isActive === false) {
            await account.deleteSession('current').catch(() => {});
            await clearServerSession();
            setUser(null);
            return;
          }
          setUser(userDoc);
        }
      } catch {
        // No active session
        await clearServerSession();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [clearServerSession, fetchUserDocument, syncServerSession]);

  useEffect(() => {
    if (!user) return;

    const refreshServerSession = () => {
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
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }, [fetchUserDocument, syncServerSession]);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await account.deleteSession('current');
      await clearServerSession();
      databases.clearReadCache?.();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }, [clearServerSession]);

  // Signup function - creates manager account by default
  const signup = useCallback(async (name: string, email: string, password: string) => {
    try {
      console.log('Starting signup process...');
      console.log('Database ID:', DATABASE_ID);
      console.log('Users Collection ID:', COLLECTIONS.USERS);

      // Create account
      console.log('Creating Appwrite account...');
      const newAccount = await account.create(
        ID.unique(),
        email,
        password,
        name
      );
      console.log('Account created successfully:', newAccount.$id);

      const signupRole = getSignupRoleForEmail(email);

      // Create user document using the account ID
      console.log('Creating user document with ID:', newAccount.$id);
      const userDoc = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        newAccount.$id, // Use the account ID as the document ID
        {
          name,
          email,
          role: signupRole,
          managerId: null,
          managerIds: [],
          assistantManagerIds: [],
          teamLeadId: null,
          isActive: true,
          branchIds: [],
        }
      );
      console.log('User document created successfully:', userDoc.$id);

      // Create session
      console.log('Creating session...');
      try {
        await account.createEmailPasswordSession(email, password);
        console.log('Session created successfully');
      } catch (sessionError: unknown) {
        // If session already exists, delete it and try again
        if (isSessionAlreadyExistsError(sessionError)) {
          console.log('Existing session found, clearing it...');
          await account.deleteSession('current');
          console.log('Creating new session...');
          await account.createEmailPasswordSession(email, password);
          console.log('Session created successfully');
        } else {
          throw sessionError;
        }
      }

      // Set user state
      await syncServerSession({ force: true });

      const userData: User = {
        $id: userDoc.$id,
        name: userDoc.name as string,
        email: userDoc.email as string,
        role: userDoc.role as UserRole,
        managerId: userDoc.managerId as string | null,
        managerIds: Array.isArray(userDoc.managerIds) ? (userDoc.managerIds as string[]) : [],
        assistantManagerId: (userDoc.assistantManagerId as string) || null,
        assistantManagerIds: Array.isArray(userDoc.assistantManagerIds)
          ? (userDoc.assistantManagerIds as string[])
          : [],
        teamLeadId: (userDoc.teamLeadId as string) || null,
        branchIds: Array.isArray(userDoc.branchIds) ? (userDoc.branchIds as string[]) : [],
        isActive: userDoc.isActive !== false,
        branchId: (userDoc.branchId as string) || null,
        $createdAt: userDoc.$createdAt,
        $updatedAt: userDoc.$updatedAt,
      };
      console.log('Setting user state:', userData);
      setUser(userData);
      console.log('Signup completed successfully');
    } catch (error: unknown) {
      console.error('Signup error details:', getErrorDetails(error));
      throw error;
    }
  }, [syncServerSession]);

  // Role-based helper properties
  const isAdmin = user?.role === 'admin';
  const isAssistantManager = user?.role === 'assistant_manager';
  // Manager includes actual managers and assistant managers (since they share access)
  // Admin is also considered a manager for access purposes
  const isManager = user?.role === 'manager' || user?.role === 'assistant_manager' || user?.role === 'admin';
  const isTeamLead = user?.role === 'team_lead';
  const isAgent = user?.role === 'agent';
  const isLeadGeneration = user?.role === 'lead_generation';

  const value: AuthContextType = {
    user,
    isAdmin,
    isManager,
    isAssistantManager,
    isTeamLead,
    isAgent,
    isLeadGeneration,
    loading,
    login,
    logout,
    signup,
  };

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
