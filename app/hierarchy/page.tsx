'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { User } from '@/lib/types';
import { Network, User as UserIcon, Users, GitGraph } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listBranches } from '@/lib/services/branch-service';

export default function HierarchyPage() {
  return (
    <ProtectedRoute componentKey="hierarchy">
      <HierarchyContent />
    </ProtectedRoute>
  );
}

function TreeNode({ user, allUsers, level = 0 }: { user: User; allUsers: User[]; level?: number }) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Find children for this node
  const directReports = allUsers.filter((u) => {
    // Manager sees Team Leads AND direct-report Agents (agents with no TL but assigned to this manager)
    if (user.role === 'manager') {
        const isAssigned = (u.managerIds && u.managerIds.includes(user.$id)) || u.managerId === user.$id;
        return (isAssigned && u.role === 'team_lead') ||
               (isAssigned && u.role === 'agent' && !u.teamLeadId);
    }
    // Team Lead sees assigned Agents
    if (user.role === 'team_lead') return u.teamLeadId === user.$id && u.role === 'agent';
    return false;
  });

  // Sort children: Team Leads first, then Agents. Alphabetically within roles.
  const sortedReports = directReports.sort((a, b) => {
    // Priority: Team Leads < Agents
    if (a.role === 'team_lead' && b.role !== 'team_lead') return -1;
    if (a.role !== 'team_lead' && b.role === 'team_lead') return 1;

    // Secondary: Alphabetical by Name
    return a.name.localeCompare(b.name);
  });

  const hasChildren = sortedReports.length > 0;

  return (
    <div className="relative pl-6">
      {/* Connector lines */}
      {level > 0 && (
        <div className="absolute left-0 top-6 w-6 h-px bg-border" />
      )}
      {/* Vertical line connecting to parent */}
      <div className="absolute left-0 top-0 h-full w-px bg-border" />

      <div className="py-2">
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border bg-card text-card-foreground shadow-sm transition-all w-fit min-w-[200px]",
            hasChildren && "cursor-pointer hover:bg-accent/50"
          )}
          onClick={() => hasChildren && setIsExpanded(!isExpanded)}
        >
          <div
            className={cn(
              "p-2 rounded-full",
              user.role === 'manager' && "bg-blue-100 text-blue-600 dark:bg-blue-900/20",
              user.role === 'team_lead' && "bg-purple-100 text-purple-600 dark:bg-purple-900/20",
              user.role === 'agent' && "bg-green-100 text-green-600 dark:bg-green-900/20"
            )}
          >
            {user.role === 'manager' && <Users className="h-4 w-4" />}
            {user.role === 'team_lead' && <UserIcon className="h-4 w-4" />}
            {user.role === 'agent' && <UserIcon className="h-4 w-4" />}
          </div>

          <div>
            <p className="font-medium text-sm">{user.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user.role.replace('_', ' ')}
            </p>
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative border-l border-border ml-6 pl-6">
          {sortedReports.map((child) => (
            <TreeNode key={child.$id} user={child} allUsers={allUsers} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function HierarchyContent() {
  const { user, isAdmin, isManager } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!user) return;

      try {
        setIsLoading(true);
        const { databases } = await import('@/lib/appwrite');
        const { Query } = await import('appwrite');

        let allUsers: any[] = [];

        if (isAdmin) {
          // Admin fetches ALL users
          const response = await databases.listDocuments(
            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
            process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
            [Query.limit(100)]
          );
          allUsers = response.documents;
        } else if (isManager && user.branchIds && user.branchIds.length > 0) {
          // Manager fetches users in their branches
          const { getUsersByBranches } = await import('@/lib/services/user-service');
          allUsers = await getUsersByBranches(user.branchIds);
        }

        const mappedUsers = allUsers.map((doc: any) => ({
          $id: doc.$id,
          name: doc.name,
          email: doc.email,
          role: doc.role,
          managerId: doc.managerId || null,
          managerIds: doc.managerIds || [],
          teamLeadId: doc.teamLeadId || null,
          branchIds: doc.branchIds || [],
          branchId: doc.branchId || null,
          $createdAt: doc.$createdAt,
          $updatedAt: doc.$updatedAt,
        })) as User[];

        setUsers(mappedUsers);
      } catch (error) {
        console.error('Error loading hierarchy:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [user, isAdmin, isManager]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Determine root nodes for the tree
  let rootUsers: User[] = [];

  // Determine unassigned agents (no manager or no team lead but not manager-assigned)
  // Actually per requirement: "if a agent is not assigned to any tl then it will always show under the manager. directly."
  // This is handled in TreeNode above.
  // But what if an agent has NO manager? (Orphaned)
  const unassignedAgents = users.filter(u => u.role === 'agent' && !u.managerId && !u.teamLeadId);

  if (isAdmin) {
    // For Admin: Roots are Managers
    rootUsers = users.filter((u) => u.role === 'manager');
  } else if (isManager && user) {
    // For Manager: Root is the current manager
    // IMPORTANT: If a manager has multiple branches, they are still one user node.
    // The previous logic filtered by ID so it's fine.
    rootUsers = users.filter((u) => u.$id === user.$id);
  }

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Organization Hierarchy</h1>
        <p className="text-muted-foreground">
          View the reporting structure of your organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Structure</CardTitle>
          <CardDescription>
            {isAdmin ? 'All Managers and their teams' : 'Your team structure'}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="min-w-[500px] p-4">
            {rootUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hierarchy data found.
              </div>
            ) : (
              <div className="space-y-8">
                {rootUsers.map((root) => (
                  <div key={root.$id} className="border-l-2 border-primary/20 pl-4">
                    <TreeNode user={root} allUsers={users} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Unassigned Agents Section (Admin Only or if visible to Manager but orphaned) */}
      {unassignedAgents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Unassigned Agents</CardTitle>
            <CardDescription>
              Agents not currently assigned to any Manager or Team Lead
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unassignedAgents.map(agent => (
                <div key={agent.$id} className="flex items-center gap-3 p-3 rounded-lg border bg-card text-card-foreground shadow-sm">
                   <div className="p-2 rounded-full bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20">
                      <UserIcon className="h-4 w-4" />
                   </div>
                   <div>
                      <p className="font-medium text-sm">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.email}</p>
                   </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
