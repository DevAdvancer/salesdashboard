'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ProtectedRoute } from '@/components/protected-route';
import { listLeads } from '@/lib/services/lead-service';
import { getAgentsByManager } from '@/lib/services/user-service';
import { FileText, History, Users, TrendingUp } from 'lucide-react';

function DashboardContent() {
  const { user, isManager, isAgent, loading } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    agentsCount: 0,
    loading: true,
  });

  useEffect(() => {
    async function fetchMetrics() {
      if (!user) return;

      try {
        // Fetch active leads count
        const activeLeads = await listLeads(
          { isClosed: false },
          user.$id,
          user.role
        );

        // Fetch closed leads count
        const closedLeads = await listLeads(
          { isClosed: true },
          user.$id,
          user.role
        );

        // Fetch agents count (managers only)
        let agentsCount = 0;
        if (isManager) {
          const agents = await getAgentsByManager(user.$id);
          agentsCount = agents.length;
        }

        setMetrics({
          activeLeads: activeLeads.length,
          closedLeads: closedLeads.length,
          agentsCount,
          loading: false,
        });
      } catch (error) {
        console.error('Error fetching metrics:', error);
        setMetrics((prev) => ({ ...prev, loading: false }));
      }
    }

    if (user) {
      fetchMetrics();
    }
  }, [user, isManager]);

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {user.name}
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.activeLeads}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isAgent ? 'Assigned to you' : 'Total active leads'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Closed Leads</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.closedLeads}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In history
            </p>
          </CardContent>
        </Card>

        {isManager && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Agents</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.loading ? '...' : metrics.agentsCount}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Team members
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* User Info and Quick Actions */}
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
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute componentKey="dashboard">
      <DashboardContent />
    </ProtectedRoute>
  );
}
