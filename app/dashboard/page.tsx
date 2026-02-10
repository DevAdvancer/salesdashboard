'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function DashboardPage() {
  const { user, isManager, isAgent, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="container mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Button onClick={handleLogout} variant="outline">
          Log out
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {user.name}!</CardTitle>
            <CardDescription>
              You are logged in as a {user.role}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm">
                <strong>Email:</strong> {user.email}
              </p>
              <p className="text-sm">
                <strong>Role:</strong> {user.role}
              </p>
              {user.managerId && (
                <p className="text-sm">
                  <strong>Manager ID:</strong> {user.managerId}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {isManager && (
          <Card>
            <CardHeader>
              <CardTitle>Manager Access</CardTitle>
              <CardDescription>
                You have full system access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a manager, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Create and manage agents</li>
                <li>Configure lead forms</li>
                <li>Manage access controls</li>
                <li>View all leads</li>
                <li>Access history and reports</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {isAgent && (
          <Card>
            <CardHeader>
              <CardTitle>Agent Access</CardTitle>
              <CardDescription>
                You have limited system access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As an agent, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>View assigned leads</li>
                <li>Edit assigned leads</li>
                <li>Close leads (if permitted)</li>
                <li>Access permitted components</li>
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => router.push('/leads')}
            >
              View Leads
            </Button>
            {isManager && (
              <>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push('/users')}
                >
                  Manage Users
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => router.push('/field-management')}
                >
                  Configure Forms
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>System Information</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This is a placeholder dashboard. Additional features will be
              implemented in subsequent tasks.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
