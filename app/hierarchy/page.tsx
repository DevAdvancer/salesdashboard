'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Branch, User } from '@/lib/types';
import { User as UserIcon, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listBranches } from '@/lib/services/branch-service';
import { client, databases } from '@/lib/appwrite';
import { getAllActiveUsers, getUsersByBranches } from '@/lib/services/user-service';
import {
  TreeNode,
  hasExistingParent,
  formatBranches,
  sortUsersForHierarchy,
} from '@/components/hierarchy/hierarchy-tree';

export default function HierarchyPage() {
  return (
    <ProtectedRoute componentKey="hierarchy">
      <HierarchyContent />
    </ProtectedRoute>
  );
}

function HierarchyContent() {
  const { user, isAdmin, isTeamLead, isMonitor } = useAuth();
  const canReadAllHierarchy = isAdmin || isMonitor;
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const reloadTimeoutRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      let allUsers: User[] = [];

      if (canReadAllHierarchy) {
        allUsers = await getAllActiveUsers();
      } else if (isTeamLead && user.branchIds && user.branchIds.length > 0) {
        allUsers = await getUsersByBranches(user.branchIds);
      }

      const branchList = await listBranches();
      // Build a per-user department map once so we can scope the
      // page to the Sales team. A branch is only shown on the
      // Sales hierarchy if at least one Sales-department user is
      // assigned to it; Resume-only branches never appear here.
      const userDeptById = new Map<string, string>();
      for (const raw of allUsers) {
        const id = String(raw.$id ?? '');
        if (!id) continue;
        const dept = String(raw.department ?? 'sales');
        userDeptById.set(id, dept);
      }
      setBranches(
        branchList.filter((branch) => {
          if (!canReadAllHierarchy) {
            if (!(user.branchIds || []).includes(branch.$id)) return false;
          }
          const assignedUserIds = allUsers.flatMap((u) => {
            const branchIds = Array.isArray(u.branchIds) ? u.branchIds : [];
            return branchIds.includes(branch.$id)
              ? [String(u.$id ?? '')]
              : [];
          });
          return assignedUserIds.some(
            (uid) => userDeptById.get(uid) !== 'resume',
          );
        }),
      );

      // Hard split: this page is the Sales hierarchy. Users with
      // department === 'resume' are never shown here, even if the
      // query above returned them. Resume Team Leads belong on
      // /resume-hierarchy, not on this tree. The default department
      // is 'sales' for legacy users, so a missing department still
      // counts as Sales — matching the assumption the rest of the
      // app makes.
      const salesOnly = allUsers.filter(
        (mapped) =>
          mapped.isActive !== false &&
          mapped.department !== 'resume',
      );
      setUsers(salesOnly);
    } catch (error) {
      console.error('Error loading hierarchy:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, canReadAllHierarchy, isTeamLead]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!user) return;

    const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

    const unsubscribe = client.subscribe(
      `databases.${databaseId}.collections.${collectionId}.documents`,
      () => {
        if (reloadTimeoutRef.current !== null) {
          window.clearTimeout(reloadTimeoutRef.current);
        }
        reloadTimeoutRef.current = window.setTimeout(() => {
          try {
            databases.clearReadCache();
          } catch {}
          void loadData();
        }, 250);
      },
    );

    return () => {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
      }
      unsubscribe();
    };
  }, [user, loadData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Determine root nodes for the tree
  let rootUsers: User[] = [];

  if (canReadAllHierarchy) {
    rootUsers = sortUsersForHierarchy(
      users.filter((u) => u.role === 'team_lead'),
    );
  } else if (user?.role === 'team_lead') {
    rootUsers = users.filter((u) => u.$id === user.$id);
  }

  const unassignedUsers = sortUsersForHierarchy(
    users.filter(
      (u) =>
        u.role !== 'admin' &&
        (u.role === 'agent' || u.role === 'lead_generation') &&
        !hasExistingParent(u, users),
    ),
  );
  const unassignedIndividualContributors = unassignedUsers.filter(
    (u) => u.role === 'agent' || u.role === 'lead_generation',
  );
  const branchMap = new Map(
    branches.map((branch) => [branch.$id, branch.name]),
  );

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Sales Team Hierarchy
        </h1>
        <p className="text-muted-foreground">
          View the reporting structure of the Sales team. Resume team
          members are not shown on this page — see
          <span className="font-medium"> Resume Team Hierarchy</span>{' '}
          for the Resume tree.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Structure</CardTitle>
          <CardDescription>
            {canReadAllHierarchy
              ? 'All Sales managers and their teams'
              : 'Your team structure'}
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
                  <div
                    key={root.$id}
                    className="border-l-2 border-primary/20 pl-4">
                    <TreeNode
                      user={root}
                      allUsers={users}
                      branchMap={branchMap}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales Branches</CardTitle>
          <CardDescription>
            {canReadAllHierarchy
              ? 'All active and inactive branches with at least one Sales team member'
              : 'Sales branches assigned to you'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No branches found.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {branches.map((branch) => (
                <div
                  key={branch.$id}
                  className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">{branch.name}</p>
                    <span
                      className={cn(
                        'rounded border px-2 py-0.5 text-xs',
                        branch.isActive
                          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
                          : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-400',
                      )}>
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {unassignedIndividualContributors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sales Users Not Under Anyone</CardTitle>
            <CardDescription>
              Sales agents / lead generation users with no existing
              Manager, Assistant Manager, or Team Lead assignment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unassignedIndividualContributors.map((agent) => (
                <div
                  key={agent.$id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card text-card-foreground shadow-sm">
                  <div className="p-2 rounded-full bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20">
                    <UserIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.email}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBranches(agent, branchMap)}
                    </p>
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
