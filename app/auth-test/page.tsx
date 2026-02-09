'use client';

import { useAuth } from '@/lib/contexts/auth-context';

export default function AuthTestPage() {
  const { user, isManager, isAgent, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Authentication Context Test</h1>

      <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Current User State</h2>

        {user ? (
          <div className="space-y-2">
            <p>
              <strong>ID:</strong> {user.$id}
            </p>
            <p>
              <strong>Name:</strong> {user.name}
            </p>
            <p>
              <strong>Email:</strong> {user.email}
            </p>
            <p>
              <strong>Role:</strong> {user.role}
            </p>
            <p>
              <strong>Manager ID:</strong> {user.managerId || 'N/A'}
            </p>
            <p>
              <strong>Is Manager:</strong> {isManager ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>Is Agent:</strong> {isAgent ? 'Yes' : 'No'}
            </p>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400">No user logged in</p>
        )}
      </div>

      <div className="mt-6">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This page demonstrates the AuthContext and useAuth hook functionality.
          The context provides user state management and role-based helper properties.
        </p>
      </div>
    </div>
  );
}
