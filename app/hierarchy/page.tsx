"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Branch, User } from "@/lib/types";
import { User as UserIcon, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { listBranches } from "@/lib/services/branch-service";
import { client, databases } from "@/lib/appwrite";

export default function HierarchyPage() {
  return (
    <ProtectedRoute componentKey="hierarchy">
      <HierarchyContent />
    </ProtectedRoute>
  );
}

function getRoleWeight(role: User["role"]) {
  switch (role) {
    case "admin":
      return -1;
    case "team_lead":
      return 2;
    case "lead_generation":
      return 3;
    case "agent":
      return 4;
    default:
      return 99;
  }
}

function sortUsersForHierarchy(users: User[]) {
  return [...users].sort((a, b) => {
    const roleDiff = getRoleWeight(a.role) - getRoleWeight(b.role);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });
}

function hasUser(allUsers: User[], userId: string | null | undefined) {
  return Boolean(userId && allUsers.some((u) => u.$id === userId));
}

function findUserById(allUsers: User[], userId: string | null | undefined) {
  return userId ? allUsers.find((u) => u.$id === userId) : undefined;
}

function hasExistingParent(target: User, allUsers: User[]) {
  if (target.role === "team_lead") return false;
  if (target.role === "agent" || target.role === "lead_generation") {
    return hasUser(allUsers, target.teamLeadId);
  }
  return false;
}

function formatBranches(user: User, branchMap: Map<string, string>) {
  if (!user.branchIds?.length) return "No branches";
  return user.branchIds
    .map((branchId) => branchMap.get(branchId) || branchId)
    .join(", ");
}

function BranchBadges({
  branchIds,
  branchMap,
}: {
  branchIds: string[];
  branchMap: Map<string, string>;
}) {
  if (!branchIds.length) {
    return (
      <span className="text-[11px] text-muted-foreground">No branches</span>
    );
  }

  return (
    <div className="mt-2 flex max-w-[360px] flex-wrap gap-1">
      {branchIds.map((branchId) => (
        <span
          key={branchId}
          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          title={branchId}>
          {branchMap.get(branchId) || branchId}
        </span>
      ))}
    </div>
  );
}

function TreeNode({
  user,
  allUsers,
  branchMap,
  level = 0,
}: {
  user: User;
  allUsers: User[];
  branchMap: Map<string, string>;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Find children for this node
  const directReports = allUsers.filter((u) => {
    // Admin / monitor / operations see all team leads
    if (user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations") {
      if (u.role === "team_lead") return true;
    }
    // Team Lead sees assigned Agents
    if (user.role === "team_lead") {
      return (
        u.teamLeadId === user.$id &&
        (u.role === "agent" || u.role === "lead_generation")
      );
    }
    return false;
  });

  // Sort children: Team Leads < Agents
  const sortedReports = sortUsersForHierarchy(directReports);

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
            hasChildren && "cursor-pointer hover:bg-accent/50",
          )}
          onClick={() => hasChildren && setIsExpanded(!isExpanded)}>
          <div
            className={cn(
              "p-2 rounded-full",
              user.role === "team_lead" &&
                "bg-purple-100 text-purple-600 dark:bg-purple-900/20",
              user.role === "lead_generation" &&
                "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20",
              user.role === "agent" &&
                "bg-green-100 text-green-600 dark:bg-green-900/20",
            )}>
            {user.role === "team_lead" && <UserIcon className="h-4 w-4" />}
            {user.role === "lead_generation" && (
              <UserIcon className="h-4 w-4" />
            )}
            {user.role === "agent" && <UserIcon className="h-4 w-4" />}
          </div>

          <div>
            <p className="font-medium text-sm">{user.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user.role.replace("_", " ")}
            </p>
            <BranchBadges
              branchIds={user.branchIds || []}
              branchMap={branchMap}
            />
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative border-l border-border ml-6 pl-6">
          {sortedReports.map((child) => (
            <TreeNode
              key={child.$id}
              user={child}
              allUsers={allUsers}
              branchMap={branchMap}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HierarchyContent() {
  const { user, isAdmin, isTeamLead, isMonitor } = useAuth();
  const canReadAllHierarchy = isAdmin || isMonitor;
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const { Query } = await import("appwrite");
      let allUsers: unknown[] = [];

      if (canReadAllHierarchy) {
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
          [Query.limit(5000)],
        );
        allUsers = response.documents;
      } else if (isTeamLead && user.branchIds && user.branchIds.length > 0) {
        const { getUsersByBranches } = await import("@/lib/services/user-service");
        allUsers = await getUsersByBranches(user.branchIds);
      }

      const branchList = await listBranches();
      setBranches(
        branchList.filter(
          (branch) => canReadAllHierarchy || (user.branchIds || []).includes(branch.$id),
        ),
      );

      const mappedUsers = allUsers.map((rawDoc) => {
        const doc = rawDoc as Record<string, unknown>;

        return {
          $id: String(doc.$id),
          name: String(doc.name ?? ""),
          email: String(doc.email ?? ""),
          role: doc.role as User["role"],
          teamLeadId: (doc.teamLeadId as string) || null,
          branchIds: Array.isArray(doc.branchIds) ? (doc.branchIds as string[]) : [],
          isActive: doc.isActive !== false,
          branchId: (doc.branchId as string) || null,
          $createdAt: doc.$createdAt as string | undefined,
          $updatedAt: doc.$updatedAt as string | undefined,
        };
      }) as User[];

      setUsers(mappedUsers.filter((mappedUser) => mappedUser.isActive !== false));
    } catch (error) {
      console.error("Error loading hierarchy:", error);
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

  // Determine root nodes for the tree
  let rootUsers: User[] = [];

  if (canReadAllHierarchy) {
    rootUsers = sortUsersForHierarchy(
      users.filter((u) => u.role === "team_lead"),
    );
  } else if (user?.role === "team_lead") {
    rootUsers = users.filter((u) => u.$id === user.$id);
  }

  const unassignedUsers = sortUsersForHierarchy(
    users.filter(
      (u) =>
        u.role !== "admin" &&
        (u.role === "agent" || u.role === "lead_generation") &&
        !hasExistingParent(u, users),
    ),
  );
  const unassignedIndividualContributors = unassignedUsers.filter(
    (u) => u.role === "agent" || u.role === "lead_generation",
  );
  const branchMap = new Map(
    branches.map((branch) => [branch.$id, branch.name]),
  );

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Organization Hierarchy
        </h1>
        <p className="text-muted-foreground">
          View the reporting structure of your organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Structure</CardTitle>
          <CardDescription>
            {canReadAllHierarchy ? "All Managers and their teams" : "Your team structure"}
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
          <CardTitle>Branches</CardTitle>
          <CardDescription>
            {canReadAllHierarchy
              ? "All active and inactive branches in the hierarchy view"
              : "Branches assigned to you"}
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
                <div key={branch.$id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">{branch.name}</p>
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 text-xs",
                        branch.isActive
                          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
                          : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-400",
                      )}>
                      {branch.isActive ? "Active" : "Inactive"}
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
            <CardTitle>Users Not Under Anyone</CardTitle>
            <CardDescription>
              Agents / lead generation users with no existing Manager, Assistant
              Manager, or Team Lead assignment
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
