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
import { getAgentsByManager, getTeamLeads } from '@/lib/services/user-service';
import { getBranchById } from '@/lib/services/branch-service';
import { FileText, Briefcase, Users, TrendingUp, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function DashboardContent() {
  const { user, isAdmin, isManager, isAgent, isTeamLead, loading } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState({
    activeLeads: 0,
    closedLeads: 0,
    teamMembersCount: 0,
    totalAmount: 0,
    netAmount: 0,
    loading: true,
  });
  const [amountData, setAmountData] = useState<any[]>([]);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);
  const [assignedAgents, setAssignedAgents] = useState<any[]>([]);
  const [isOutlookChecking, setIsOutlookChecking] = useState(true);

  // Check Outlook connection status
  useEffect(() => {
    const checkOutlookConnection = async () => {
      try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();

        if (!data.connected) {
          // If not connected, redirect to login
          console.log('Outlook not connected, redirecting to login...');
          window.location.href = '/api/auth/login';
        } else {
          setIsOutlookChecking(false);
        }
      } catch (error) {
        console.error('Failed to check Outlook status:', error);
        setIsOutlookChecking(false);
      }
    };

    if (user) {
      checkOutlookConnection();
    }
  }, [user]);

  useEffect(() => {
    async function fetchMetrics() {
      if (!user) return;

      try {
        // Fetch active leads count
        const activeLeads = await listLeads(
          { isClosed: false },
          user.$id,
          user.role,
          user.branchIds
        );

        // Fetch closed leads count
        const closedLeads = await listLeads(
          { isClosed: true },
          user.$id,
          user.role,
          user.branchIds
        );

        // Fetch team members count and agents for team lead
        let teamMembersCount = 0;
        if (isAdmin || isManager || isTeamLead) {
          if (isTeamLead) {
            const { getAgentsByTeamLead } = await import('@/lib/services/user-service');
            const agents = await getAgentsByTeamLead(user.$id);

            // Fetch branch names for each agent
            const agentsWithBranches = await Promise.all(agents.map(async (agent) => {
              if (agent.branchIds && agent.branchIds.length > 0) {
                // Assuming we want to show the first branch or join them
                // For simplicity, let's fetch the first branch name
                try {
                    const branchNames = await Promise.all(agent.branchIds.map(async (bid) => {
                        const branch = await getBranchById(bid);
                        return branch.name;
                    }));
                    return { ...agent, branchNames: branchNames.join(', ') };
                } catch (e) {
                    return { ...agent, branchNames: 'Unknown' };
                }
              }
              return { ...agent, branchNames: 'N/A' };
            }));

            teamMembersCount = agents.length;
            setAssignedAgents(agentsWithBranches);
          } else if (isManager) {
            const { getUsersByBranches } = await import('@/lib/services/user-service');
            if (user.branchIds && user.branchIds.length > 0) {
              const users = await getUsersByBranches(user.branchIds);
              teamMembersCount = users.filter(u => u.role === 'team_lead').length;
            }
          } else if (isAdmin) {
            const teamLeads = await getTeamLeads();
            teamMembersCount = teamLeads.length;
          }
        }

        // Calculate Amounts (Total and Net)
        let totalAmount = 0;
        let netAmount = 0;
        const monthlyData: { [key: string]: { total: number; net: number } } = {};

        // Process all leads (active + closed) for amounts
        [...activeLeads, ...closedLeads].forEach(lead => {
            let leadData: any;
            try {
                leadData = JSON.parse(lead.data);
            } catch (e) { return; }

            const amount = parseFloat(leadData.dealValue || '0') || 0;
            // Assuming Net Amount is same as Total for now, or if there's a specific field like 'netValue'
            // If netValue exists use it, else use dealValue
            const net = parseFloat(leadData.netValue || leadData.dealValue || '0') || 0;

            // Only add if amount > 0
            if (amount > 0) {
                totalAmount += amount;
                netAmount += net;

                // Group by Month for Chart
                const date = new Date(lead.$createdAt || new Date());
                const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                
                if (!monthlyData[monthKey]) {
                    monthlyData[monthKey] = { total: 0, net: 0 };
                }
                monthlyData[monthKey].total += amount;
                monthlyData[monthKey].net += net;
            }
        });

        // Format chart data
        const chartData = Object.entries(monthlyData).map(([name, data]) => ({
            name,
            Total: data.total,
            Net: data.net
        }));

        setMetrics({
          activeLeads: activeLeads.length,
          closedLeads: closedLeads.length,
          teamMembersCount,
          totalAmount,
          netAmount,
          loading: false,
        });
        setAmountData(chartData);
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

  if (!user || isOutlookChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">
          {!user ? 'Loading user...' : 'Checking Outlook connection...'}
        </p>
      </div>
    );
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
            <CardTitle className="text-sm font-medium">Clients</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.loading ? '...' : metrics.closedLeads}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In client records
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

      {/* Amount Insights Graph (Admin Only) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Financial Insights</CardTitle>
            <CardDescription>Revenue overview over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="flex flex-col gap-1 p-4 border rounded-lg bg-card shadow-sm">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <DollarSign className="h-4 w-4" /> Total Deal Value
                    </span>
                    <span className="text-2xl font-bold">${metrics.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-1 p-4 border rounded-lg bg-card shadow-sm">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Net Revenue
                    </span>
                    <span className="text-2xl font-bold text-green-600">${metrics.netAmount.toLocaleString()}</span>
                </div>
            </div>

            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={amountData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip
                            formatter={(value) => `$${Number(value).toLocaleString()}`}
                            contentStyle={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                        />
                        <Legend />
                        <Bar dataKey="Total" fill="#8884d8" name="Total Deal Value" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Net" fill="#82ca9d" name="Net Revenue" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

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
                <li>View all leads and clients</li>
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
                <li>Access client records and reports</li>
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
                <li>Access client records and reports</li>
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
                  onClick={() => router.push('/users?action=create')}
                >
                  Create User
                </Button>
              </>
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

      {/* Assigned Agents Section (Team Lead Only) */}
      {isTeamLead && assignedAgents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Agents</CardTitle>
            <CardDescription>
              Agents assigned to your team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3 font-semibold text-sm">Name</th>
                    <th className="p-3 font-semibold text-sm">Email</th>
                    <th className="p-3 font-semibold text-sm">Branch</th>
                    <th className="p-3 font-semibold text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedAgents.map((agent) => (
                    <tr key={agent.$id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-3 text-sm">{agent.name}</td>
                      <td className="p-3 text-sm text-muted-foreground">{agent.email}</td>
                      <td className="p-3 text-sm">{agent.branchNames || 'N/A'}</td>
                      <td className="p-3 text-sm">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
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
