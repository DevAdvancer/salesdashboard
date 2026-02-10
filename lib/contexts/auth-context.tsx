'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { User, UserRole, AuthContext as AuthContextType } from '@/lib/types';
import { ID, Models } from 'appwrite';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user document from database
  const fetchUserDocument = useCallback(async (userId: string): Promise<User | null> => {
    try {
      const userDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        userId
      );

      return {
        $id: userDoc.$id,
        name: userDoc.name as string,
        email: userDoc.email as string,
        role: userDoc.role as UserRole,
        managerId: userDoc.managerId as string | null,
        branchId: (userDoc.branchId as string) || null,
        $createdAt: userDoc.$createdAt,
        $updatedAt: userDoc.$updatedAt,
      };
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
          const userDoc = await fetchUserDocument(session.$id);
          setUser(userDoc);
        }
      } catch (error) {
        // No active session
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [fetchUserDocument]);

  // Login function
  const login = useCallback(async (email: string, password: string) => {
    try {
      // Create email session
      await account.createEmailPasswordSession(email, password);

      // Get account details
      const accountDetails = await account.get();

      // Fetch user document
      const userDoc = await fetchUserDocument(accountDetails.$id);

      if (!userDoc) {
        throw new Error('User document not found');
      }

      setUser(userDoc);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }, [fetchUserDocument]);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await account.deleteSession('current');
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }, []);

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

      // Create user document with manager role using the account ID
      console.log('Creating user document with ID:', newAccount.$id);
      const userDoc = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        newAccount.$id, // Use the account ID as the document ID
        {
          name,
          email,
          role: 'manager',
          managerId: null,
        }
      );
      console.log('User document created successfully:', userDoc.$id);

      // Create session
      console.log('Creating session...');
      try {
        await account.createEmailPasswordSession(email, password);
        console.log('Session created successfully');
      } catch (sessionError: any) {
        // If session already exists, delete it and try again
        if (sessionError.code === 401 && sessionError.type === 'user_session_already_exists') {
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
      const userData = {
        $id: userDoc.$id,
        name: userDoc.name as string,
        email: userDoc.email as string,
        role: userDoc.role as UserRole,
        managerId: userDoc.managerId as string | null,
        branchId: (userDoc.branchId as string) || null,
        $createdAt: userDoc.$createdAt,
        $updatedAt: userDoc.$updatedAt,
      };
      console.log('Setting user state:', userData);
      setUser(userData);
      console.log('Signup completed successfully');
    } catch (error: any) {
      console.error('Signup error details:', {
        message: error.message,
        code: error.code,
        type: error.type,
        response: error.response,
      });
      throw error;
    }
  }, []);

  // Role-based helper properties
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAgent = user?.role === 'agent';

  const value: AuthContextType = {
    user,
    isAdmin,
    isManager,
    isAgent,
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
