'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { User as UserIcon } from 'lucide-react';
import { listBranches } from '@/lib/services/branch-service';
import { client, databases } from '@/lib/appwrite';
import {
  TreeNode,
  hasExistingParent,
  formatBranches,
  sortUsersForHierarchy,
} from '@/components/hierarchy/hierarchy-tree';

export default function ResumeHierarchyPage() {
  return (
    <ProtectedRoute componentKey="resume-hierarchy">
      <ResumeHierarchyContent />
    </ProtectedRoute>
  );
}

function ResumeHierarchyContent() {
  const { user, isAdmin, isMonitor } = useAuth();
  // The resume page is only reachable for Resume-team members and the
  // leadership roles. Both groups should see the full Resume tree.
  const canReadAllHierarchy = isAdmin || isMonitor;
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const { Query } = await import('appwrite');
      let allUsers: unknown[] = [];

      if (canReadAllHierarchy) {
        // Admin / monitor: pull every user, then filter to Resume below.
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
          [Query.limit(5000)],
        );
        allUsers = response.documents;
      } else {
        // Resume-team member: pull only users in their branches, then
        // narrow to the Resume department. This is a defense-in-depth
        // filter — ProtectedRoute already gates by department, but the
        // page itself must never display a Sales user even if the gate
        // were misconfigured.
        const { getUsersByBranches } = await import(
          '@/lib/services/user-service'
        );
        allUsers = await getUsersByBranches(user.branchIds || []);
      }

      const branchList = await listBranches();
      // Build a per-user department map once, then use it to filter the
      // branch list. A branch is only shown on the Resume page if at
      // least one Resume-department user is assigned to it. Branches
      // whose only assignees are Sales-team members are filtered out so
      // the page never cross-contaminates the two teams.
      const userDeptById = new Map<string, string>();
      for (const raw of allUsers) {
        const id = String((raw as { $id?: unknown }).$id ?? '');
        if (!id) continue;
        const dept = String(
          (raw as { department?: unknown }).department ?? 'sales',
        );
        userDeptById.set(id, dept);
      }
      setBranches(
        branchList.filter((branch) => {
          if (!canReadAllHierarchy) {
            if (!(user.branchIds || []).includes(branch.$id)) return false;
          }
          const assignedUserIds = (
            allUsers as Array<{ branchIds?: unknown }>
          ).flatMap((u) => {
            const branchIds = Array.isArray(u.branchIds)
              ? (u.branchIds as string[])
              : [];
            return branchIds.includes(branch.$id)
              ? [String((u as { $id?: unknown }).$id ?? '')]
              : [];
          });
          return assignedUserIds.some(
            (uid) => userDeptById.get(uid) === 'resume',
          );
        }),
      );

      const mappedUsers = allUsers.map((rawDoc) => {
        const doc = rawDoc as Record<string, unknown>;

        return {
          $id: String(doc.$id),
          name: String(doc.name ?? ''),
          email: String(doc.email ?? ''),
          role: doc.role as User['role'],
          teamLeadId: (doc.teamLeadId as string) || null,
          branchIds: Array.isArray(doc.branchIds)
            ? (doc.branchIds as string[])
            : [],
          isActive: doc.isActive !== false,
          branchId: (doc.branchId as string) || null,
          $createdAt: doc.$createdAt as string | undefined,
          $updatedAt: doc.$updatedAt as string | undefined,
        };
      }) as User[];

      // Hard split: only users on the Resume team are rendered. A
      // user with a missing or 'sales' department is never shown on
      // this page, even if they were returned by the query above.
      const resumeOnly = mappedUsers.filter(
        (mapped) =>
          mapped.isActive !== false &&
          // Treat the default 'sales' users as out-of-scope here.
          (mapped as unknown as { department?: string }).department ===
            'resume',
      );
      setUsers(resumeOnly);
    } catch (error) {
      console.error('Error loading resume hierarchy:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, canReadAllHierarchy]);

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
        try {
          databases.clearReadCache();
        } catch {}
        void loadData();
      },
    );

    return () => {
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

  // Root nodes are the Resume team leads. We never include admin /
  // monitor / operations / developer as roots here — the resume tree
  // is the team-lead-and-below graph for the Resume department only.
  const rootUsers = sortUsersForHierarchy(
    users.filter((u) => u.role === 'team_lead'),
  );

  const unassignedUsers = sortUsersForHierarchy(
    users.filter(
      (u) =>
        (u.role === 'agent' || u.role === 'lead_generation') &&
        !hasExistingParent(u, users),
    ),
  );
  const branchMap = new Map(
    branches.map((branch) => [branch.$id, branch.name]),
  );

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Resume Team Hierarchy
        </h1>
        <p className="text-muted-foreground">
          View the reporting structure of the Resume team. Sales team
          members are not shown on this page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Structure</CardTitle>
          <CardDescription>
            {canReadAllHierarchy
              ? 'All Resume managers and their teams'
              : 'Your team structure'}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="min-w-[500px] p-4">
            {rootUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No Resume hierarchy data found.
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

      {unassignedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resume Users Not Under Anyone</CardTitle>
            <CardDescription>
              Resume agents / lead generation users with no assigned Team
              Lead
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unassignedUsers.map((agent) => (
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
