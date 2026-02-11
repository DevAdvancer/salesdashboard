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
  const { user, isAdmin, isManager, isAgent, isTeamLead, loading } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    teamMembersCount: 0,
    loading: true,
  });
  const [managerName, setManagerName] = useState<string | null>(null);
  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);

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

        // Fetch team members count
        let teamMembersCount = 0;
        if (isAdmin || isManager || isTeamLead) {
          const { getUsersByBranches } = await import('@/lib/services/user-service');
          
          if (user.branchIds && user.branchIds.length > 0) {
            const users = await getUsersByBranches(user.branchIds);
            
            if (isManager) {
              // Managers see team leads count
              teamMembersCount = users.filter(u => u.role === 'team_lead').length;
            } else if (isTeamLead) {
              // Team leads see agents count
              teamMembersCount = users.filter(u => u.role === 'agent').length;
            } else if (isAdmin) {
              // Admins see all users count
              teamMembersCount = users.length;
            }
          }
        }

        setMetrics({
          activeLeads: activeLeads.length,
          closedLeads: closedLeads.length,
          teamMembersCount,
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
  }, [user, isAdmin, isManager, isTeamLead]);

  useEffect(() => {
    async function fetchUserNames() {
      if (!user) return;

      try {
        const { databases } = await import('@/lib/appwrite');
        
        // Fetch manager name if user has managerId
        if (user.managerId) {
          const managerDoc = await databases.getDocument(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
            user.managerId
          );
          setManagerName(managerDoc.name);
        }

        // Fetch team lead name if user has teamLeadId
        if (user.teamLeadId) {
          const teamLeadDoc = await databases.getDocument(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
            user.teamLeadId
          );
          setTeamLeadName(teamLeadDoc.name);
        }
      } catch (error) {
        console.error('Error fetching user names:', error);
      }
    }

    if (user) {
      fetchUserNames();
    }
  }, [user]);

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

        {isAgent && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.loading ? '...' : metrics.activeLeads + metrics.closedLeads}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                All your leads
              </p>
            </CardContent>
          </Card>
        )}

        {(isAdmin || isManager || isTeamLead) && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {isManager ? 'Team Leads' : isTeamLead ? 'Agents' : 'Team Members'}
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.loading ? '...' : metrics.teamMembersCount}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isManager ? 'Your team leads' : isTeamLead ? 'Your agents' : 'Team members'}
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
              You are logged in as a {user.role === 'team_lead' ? 'team lead' : user.role}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm">
                <strong>Email:</strong> {user.email}
              </p>
              <p className="text-sm">
                <strong>Role:</strong> {user.role === 'team_lead' ? 'Team Lead' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              </p>
              {managerName && (
                <p className="text-sm">
                  <strong>Manager:</strong> {managerName}
                </p>
              )}
              {teamLeadName && (
                <p className="text-sm">
                  <strong>Team Lead:</strong> {teamLeadName}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Admin Access</CardTitle>
              <CardDescription>
                You have full system access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As an admin, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Manage all branches</li>
                <li>Create and manage users</li>
                <li>Configure lead forms</li>
                <li>Manage access controls</li>
                <li>View all leads and history</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {!isAdmin && isManager && (
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
                <li>Create and manage team leads</li>
                <li>Configure lead forms</li>
                <li>Manage access controls</li>
                <li>View all leads</li>
                <li>Access history and reports</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {isTeamLead && (
          <Card>
            <CardHeader>
              <CardTitle>Team Lead Access</CardTitle>
              <CardDescription>
                You can manage your team
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                As a team lead, you can:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Create and manage agents</li>
                <li>View team leads</li>
                <li>Assign and manage leads</li>
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

        <Card className="md:col-span-2 lg:col-span-1">
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
            {(isAdmin || isManager || isTeamLead) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/users')}
              >
                Manage Users
              </Button>
            )}
            {(isAdmin || isManager) && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/field-management')}
              >
                Configure Forms
              </Button>
            )}
            {isAdmin && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/branches')}
              >
                Manage Branches
              </Button>
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
