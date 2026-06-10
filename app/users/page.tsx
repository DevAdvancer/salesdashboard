"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  createAdminAction,
  createTeamLeadAction,
  createAgentAction,
} from "@/app/actions/user";
import { getVisibleUserBranches } from "@/lib/utils/branch-visibility";
import { listBranches } from "@/lib/services/branch-service";
import { invalidateUsersCache } from "@/lib/services/user-service";
import { User, Branch, UserRole } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProtectedRoute } from "@/components/protected-route";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { client, databases } from "@/lib/appwrite";

export default function UserManagementPage() {
  return (
    <ProtectedRoute componentKey="user-management">
      <UserManagementContent />
    </ProtectedRoute>
  );
}

function UserManagementContent() {
  const searchParams = useSearchParams();
  const { user, isAdmin, isDeveloper, isTeamLead, isMonitor, isOperations } =
    useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [currentUsersPage, setCurrentUsersPage] = useState(1);
  const USERS_PAGE_SIZE = 50;
  const [search, setSearch] = useState("");
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [branchMap, setBranchMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [activeStatusUserId, setActiveStatusUserId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string | null>(
    null,
  );
  const [editRole, setEditRole] = useState<UserRole | null>(null); // Only for Edit
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [availableTeamLeads, setAvailableTeamLeads] = useState<User[]>([]);

  // Create Role State
  const [createRole, setCreateRole] = useState<
    | "admin"
    | "developer"
    | "team_lead"
    | "agent"
    | "lead_generation"
    | "monitor"
    | "operations"
  >("team_lead");
  // Initialize createRole when dialog opens or user changes
  useEffect(() => {
    if (isAdmin || isDeveloper) setCreateRole("admin");
    else if (isTeamLead) setCreateRole("agent");
  }, [isAdmin, isDeveloper, isTeamLead, showCreateDialog]);

  // Determine which role the current user can create
  const canCreateAdmin = isAdmin || isDeveloper;
  const canCreateDeveloper = isAdmin || isDeveloper;
  const canCreateTeamLead = isAdmin || isDeveloper;
  const canCreateAgent = isAdmin || isDeveloper || isTeamLead;
  const canCreateLeadGeneration =
    isAdmin || isDeveloper || isTeamLead;
  const canCreateMonitor = isAdmin || isDeveloper;
  const canCreateOperations = isAdmin || isDeveloper;
  const canCreate =
    canCreateAdmin ||
    canCreateAdmin ||
    canCreateDeveloper ||
    canCreateTeamLead ||
    canCreateAgent ||
    canCreateLeadGeneration ||
    canCreateMonitor ||
    canCreateOperations;

  useEffect(() => {
    if (searchParams.get("action") === "create" && canCreate) {
      setShowCreateDialog(true);
    }
  }, [searchParams, canCreate]);

  // The branches available for assignment (subset of current user's branchIds)
  const availableBranches = allBranches.filter(
    (b) => b.isActive && (isAdmin || isDeveloper || isMonitor || isOperations || (user?.branchIds ?? []).includes(b.$id)),
  );

  const fetchUsers = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      if (isAdmin || isDeveloper || isMonitor || isOperations) {
        // Admin/read-only visibility roles see all users (paginated)
        const { Query } = await import("appwrite");
        // Project only the fields the table actually renders.
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
          [
            Query.limit(USERS_PAGE_SIZE),
            Query.offset((currentUsersPage - 1) * USERS_PAGE_SIZE),
            Query.select([
              '$id',
              '$createdAt',
              '$updatedAt',
              'name',
              'email',
              'role',
              'isActive',
              'managerId',
              'managerIds',
              'assistantManagerId',
              'assistantManagerIds',
              'teamLeadId',
              'branchId',
              'branchIds',
            ]),
          ],
        );
        const pageUsers = response.documents.map((doc: any) => ({
          $id: doc.$id,
          name: doc.name,
          email: doc.email,
          role: doc.role,
          managerId: doc.managerId || null,
          managerIds: doc.managerIds || [],
          assistantManagerId: doc.assistantManagerId || null,
          assistantManagerIds: doc.assistantManagerIds || [],
          teamLeadId: doc.teamLeadId || null,
          branchIds: doc.branchIds || [],
          isActive: doc.isActive !== false,
          branchId: doc.branchId || null,
          $createdAt: doc.$createdAt,
          $updatedAt: doc.$updatedAt,
        })).filter((mappedUser: User) => (
          mappedUser.role !== "manager" && mappedUser.role !== "assistant_manager"
        ));

        const roleOrder: Record<string, number> = {
          admin: 0,
          developer: 0,
          monitor: 1,
          operations: 1,
          team_lead: 2,
          lead_generation: 3,
          agent: 4,
        };

        pageUsers.sort((a: User, b: User) => {
          const roleA = roleOrder[a.role] ?? 99;
          const roleB = roleOrder[b.role] ?? 99;
          if (roleA !== roleB) return roleA - roleB;
          return a.name.localeCompare(b.name);
        });

        setUsers(pageUsers);
        setUsersTotal(response.total);
        // Note: setAvailableTeamLeads is handled by fetchTeamLeadsOnly to
        // ensure ALL team leads are available, not just ones on the current page.
      } else if (user.role === "team_lead") {
        // Team Lead sees their agents
        const { getAgentsByTeamLead } =
          await import("@/lib/services/user-service");
        const agentsList = await getAgentsByTeamLead(user.$id);
        setUsers(agentsList);
        setUsersTotal(agentsList.length);
      } else {
        // Agents see no one
        setUsers([]);
        setUsersTotal(0);
      }
    } catch (err: any) {
      console.error("Error fetching users:", err);
      setError(err.message || "Failed to fetch users");
    } finally {
      setIsLoading(false);
    }
  }, [user, isAdmin, isDeveloper, isMonitor, isOperations, currentUsersPage]);

  // Separate fetch for the team leads dropdown (needs ALL team leads, not just current page).
  // This ensures team leads on other pages are still available for selection.
  const fetchTeamLeadsOnly = useCallback(async () => {
    if (!user) return;
    if (!isAdmin && !isDeveloper) return; // Only admin/developer need this

    try {
      const { Query } = await import("appwrite");
      const response = await databases.listDocuments(
        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
        process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
        [
          Query.equal("role", "team_lead"),
          Query.equal("isActive", [true]),
        ],
      );
      const teamLeads = response.documents.map((doc: any) => ({
        $id: doc.$id,
        name: doc.name,
        email: doc.email,
        role: doc.role,
        managerId: doc.managerId || null,
        managerIds: doc.managerIds || [],
        assistantManagerId: doc.assistantManagerId || null,
        assistantManagerIds: doc.assistantManagerIds || [],
        teamLeadId: doc.teamLeadId || null,
        branchIds: doc.branchIds || [],
        isActive: doc.isActive !== false,
        branchId: doc.branchId || null,
        $createdAt: doc.$createdAt,
        $updatedAt: doc.$updatedAt,
      }));
      setAvailableTeamLeads(teamLeads);
    } catch (err) {
      console.error("Error fetching team leads:", err);
    }
  }, [user, isAdmin, isDeveloper]);

  useEffect(() => {
    if (user) {
      void fetchUsers();
      void fetchBranches();
      void fetchTeamLeadsOnly();
    }
  }, [user, fetchUsers, fetchTeamLeadsOnly]);

  useEffect(() => {
    if (!user) return;

    const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

    // Debounce realtime-driven refetches. Bulk imports can fire many
    // events in <100ms; without this, we'd refetch the entire users list
    // once per event. 250ms is short enough to feel live, long enough to
    // coalesce a burst.
    const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };
    const scheduleRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          databases.clearReadCache();
        } catch {}
        // Realtime update — drop our cached users list too so the change
        // shows up on the next page that consults the cache.
        invalidateUsersCache();
        void fetchUsers();
      }, 250);
    };

    const unsubscribe = client.subscribe(
      `databases.${databaseId}.collections.${collectionId}.documents`,
      scheduleRefetch,
    );

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unsubscribe();
    };
  }, [user, fetchUsers]);

  const fetchBranches = async () => {
    try {
      const branchesList = await listBranches();
      setAllBranches(branchesList);
      const map = new Map<string, string>();
      branchesList.forEach((b) => map.set(b.$id, b.name));
      setBranchMap(map);
    } catch (err: any) {
      console.error("Error fetching branches:", err);
    }
  };

  useEffect(() => {
    async function loadTeamLeads() {
      // Load Team Leads when Admin/Manager is creating Agent/TL or editing Agent/TL
      const isAgentTarget =
        (showCreateDialog &&
          (createRole === "agent" || createRole === "lead_generation" || createRole === "monitor" || createRole === "operations")) ||
        editingUser?.role === "agent" ||
        editingUser?.role === "lead_generation" ||
        editingUser?.role === "monitor" ||
        editingUser?.role === "operations";
      // For Admin, also load if creating Team Lead? No, Team Lead doesn't report to Team Lead.

      if (isAdmin && isAgentTarget) {
        try {
          const { getTeamLeads } = await import("@/lib/services/user-service");

          let teamLeads: User[] = [];
          if (isAdmin) {
            teamLeads = await getTeamLeads();
          }

          setAvailableTeamLeads(teamLeads);
        } catch (err) {
          console.error("Error loading team leads:", err);
        }
      }
    }

    if (showCreateDialog || editingUser) {
      loadTeamLeads();
    }
  }, [showCreateDialog, editingUser, createRole, isAdmin, user]);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setSelectedBranchIds([]);
    setSelectedTeamLeadId(null);
    setFormErrors({});
    setError(null);
  }, []);

  const validateForm = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!formName.trim()) errs.name = "Name is required";
    if (!formEmail.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail))
      errs.email = "Invalid email address";
    if (!formPassword) errs.password = "Password is required";
    else if (formPassword.length < 8)
      errs.password = "Password must be at least 8 characters";
    if (createRole !== "admin" && createRole !== "developer" && createRole !== "monitor" && createRole !== "operations" && selectedBranchIds.length === 0)
      errs.branches = "At least one branch must be selected";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formName, formEmail, formPassword, createRole, selectedBranchIds]);

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId],
    );
  };

  const handleEdit = useCallback((userToEdit: User) => {
    setEditingUser(userToEdit);
    setSelectedBranchIds(userToEdit.branchIds || []);
    setSelectedTeamLeadId(userToEdit.teamLeadId || null);
    setEditRole(userToEdit.role);
    setError(null);
  }, []);

  const handleUpdateUser = useCallback(async () => {
    if (!editingUser || !user) return;

    try {
      setIsUpdating(true);
      setError(null);

      const { updateUserAction } = await import("@/app/actions/user");

      const role = (editRole as UserRole) || undefined;

      if (
        (role === "agent" || role === "lead_generation") &&
        !selectedTeamLeadId
      ) {
        setError("Agents must be assigned to a Team Lead");
        setIsUpdating(false);
        return;
      }

      await updateUserAction({
        userId: editingUser.$id,
        role,
        teamLeadId:
          role === "agent" || role === "lead_generation"
            ? selectedTeamLeadId
            : null,
        branchIds: selectedBranchIds,
        currentUserId: user.$id,
      });

      setEditingUser(null);
      setSelectedBranchIds([]);
      invalidateUsersCache();
      await fetchUsers();
    } catch (err: any) {
      console.error("Error updating user:", err);
      setError(err.message || "Failed to update user");
    } finally {
      setIsUpdating(false);
    }
  }, [
    editingUser,
    user,
    editRole,
    selectedTeamLeadId,
    selectedBranchIds,
    fetchUsers,
  ]);

  const handleDeleteUser = useCallback(async (userToDelete: User) => {
    if (!user || (!isAdmin && !isDeveloper) || userToDelete.$id === user.$id) return;

    const confirmed = await confirm({
      title: `Delete ${userToDelete.name}?`,
      description: "This removes their login and user profile.",
      confirmText: "Delete",
      cancelText: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      setDeletingUserId(userToDelete.$id);
      setError(null);

      const { deleteUserAction } = await import("@/app/actions/user");
      await deleteUserAction({
        userId: userToDelete.$id,
        currentUserId: user.$id,
      });

      invalidateUsersCache();
      await fetchUsers();
    } catch (err: unknown) {
      console.error("Error deleting user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  }, [user, isAdmin, isDeveloper, confirm, fetchUsers]);

  const handleSetAgentActive = useCallback(async (agent: User, isActive: boolean) => {
    if (
      !user ||
      !isAdmin && !isDeveloper ||
      (agent.role !== "agent" && agent.role !== "lead_generation" && agent.role !== "monitor" && agent.role !== "operations")
    )
      return;

    const confirmed = await confirm({
      title: isActive
        ? `Reactivate ${agent.name}?`
        : `Inactivate ${agent.name}?`,
      description: isActive
        ? "They will be able to log in again."
        : "They will be removed from their team, hidden from hierarchy, and blocked from logging in.",
      confirmText: isActive ? "Reactivate" : "Inactivate",
      cancelText: "Cancel",
      destructive: !isActive,
    });
    if (!confirmed) return;

    try {
      setActiveStatusUserId(agent.$id);
      setError(null);

      const { setAgentActiveAction } = await import("@/app/actions/user");
      await setAgentActiveAction({
        userId: agent.$id,
        isActive,
        currentUserId: user.$id,
      });

      invalidateUsersCache();
      await fetchUsers();
    } catch (err: unknown) {
      console.error("Error updating agent active status:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update agent active status",
      );
    } finally {
      setActiveStatusUserId(null);
    }
  }, [user, isAdmin, isDeveloper, confirm, fetchUsers]);

  const handleCreate = useCallback(async () => {
    if (!user || !validateForm()) return;

    try {
      setIsCreating(true);
      setError(null);

      if (isAdmin || isDeveloper) {
        if (createRole === "admin") {
          await createAdminAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            currentUserId: user.$id,
          });
        } else if (createRole === "developer") {
          const { createDeveloperAction } = await import("@/app/actions/user");
          await createDeveloperAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            currentUserId: user.$id,
          });
        } else if (createRole === "team_lead") {
          await createTeamLeadAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        } else {
          if (createRole !== "monitor" && createRole !== "operations" && !selectedTeamLeadId) {
            setError(
              "Agents must be assigned to a Team Lead",
            );
            setIsCreating(false);
            return;
          }

          await createAgentAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            role:
              createRole === "lead_generation"
                ? "lead_generation"
                : createRole === "monitor"
                  ? "monitor"
                  : createRole === "operations"
                    ? "operations"
                  : "agent",
            teamLeadId: createRole === "monitor" || createRole === "operations" ? undefined : selectedTeamLeadId || undefined,
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        }
      } else if (canCreateAgent) {
        await createAgentAction({
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          role: createRole === "lead_generation" ? "lead_generation" : "agent",
          teamLeadId: user.$id,
          branchIds: selectedBranchIds,
          currentUserId: user.$id,
        });
      }

      resetForm();
      setShowCreateDialog(false);
      invalidateUsersCache();
      await fetchUsers();
    } catch (err: any) {
      console.error("Error creating user:", err);
      setError(err.message || "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  }, [
    user,
    validateForm,
    isAdmin,
    isDeveloper,
    canCreateAgent,
    createRole,
    formName,
    formEmail,
    formPassword,
    selectedTeamLeadId,
    selectedBranchIds,
    fetchUsers,
    resetForm,
  ]);

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    developer: "Developer",
    team_lead: "Team Lead",
    agent: "Agent",
    lead_generation: "Lead Generation",
    monitor: "Monitor",
    operations: "Operations",
  };
  const createButtonLabel = "Create User";
  const dialogTitle = "Create User";

  const dialogDescription = isAdmin
    ? "Add a new user and assign them to branches"
    : "Add a new team member and assign them to your branches";

  const formatRole = (role: string) => {
    switch (role) {
      case "admin":
        return "Admin";
      case "developer":
        return "Developer";
      case "team_lead":
        return "Team Lead";
      case "agent":
        return "Agent";
      case "lead_generation":
        return "Lead Generation";
      case "monitor":
        return "Monitor";
      case "operations":
        return "Operations";
      default:
        return role;
    }
  };

  const formatBranches = (targetUserBranchIds: string[]) => {
    if (!targetUserBranchIds || targetUserBranchIds.length === 0) return "—";

    // Calculate visible branches based on current user's role and assignments.
    const { visibleBranchIds, hasVisibilityMismatch } = getVisibleUserBranches(
      targetUserBranchIds,
      user?.role || "agent",
      user?.branchIds || [],
      (msg, meta) => console.warn(`[BranchVisibility] ${msg}`, meta),
    );

    const branchNames = visibleBranchIds
      .map((id) => branchMap.get(id) || id)
      .join(", ");

    if (hasVisibilityMismatch && isAdmin) {
      return branchNames || "—";
    }

    return branchNames || "—";
  };

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;

    return users.filter((u) => {
      const name = (u.name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      const role = (u.role ?? "").toLowerCase();
      const branches = (u.branchIds ?? [])
        .map((id) => (branchMap.get(id) ?? id).toLowerCase())
        .join(" ");

      return (
        name.includes(query) ||
        email.includes(query) ||
        role.includes(query) ||
        branches.includes(query)
      );
    });
  }, [branchMap, search, users]);

  return (
    <div className="container mx-auto">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage your team members</CardDescription>
            </div>
            {canCreate && (
              <Button
                onClick={() => {
                  resetForm();
                  setShowCreateDialog(true);
                }}
                type="button"
                className="cursor-pointer">
                {createButtonLabel}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && !showCreateDialog && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                No users found.{" "}
                {canCreate ? "Create your first user to get started." : ""}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="sm:col-span-2 md:col-span-1">
                  <Label htmlFor="userSearch">Search</Label>
                  <Input
                    id="userSearch"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, email, role, branch..."
                    className="mt-1"
                  />
                </div>
              </div>

              {filteredUsers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">
                    No users match your search.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-4 font-semibold">
                          Name
                        </th>
                        <th className="text-left py-3 px-4 font-semibold">
                          Email
                        </th>
                        <th className="text-left py-3 px-4 font-semibold">
                          Role
                        </th>
                        <th className="text-left py-3 px-4 font-semibold">
                          Status
                        </th>
                        <th className="text-left py-3 px-4 font-semibold">
                          Branches
                        </th>
                        <th className="text-left py-3 px-4 font-semibold">
                          Created
                        </th>
                        {isAdmin && (
                          <th className="text-left py-3 px-4 font-semibold">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr
                          key={u.$id}
                          className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="py-3 px-4">{u.name}</td>
                          <td className="py-3 px-4">{u.email}</td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                              {formatRole(u.role)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                u.isActive === false
                                  ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                                  : "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                              }`}>
                              {u.isActive === false ? "Inactive" : "Active"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {formatBranches(u.branchIds)}
                          </td>
                          <td className="py-3 px-4">
                            {u.$createdAt
                              ? new Date(u.$createdAt).toLocaleDateString()
                              : "N/A"}
                          </td>
                          {isAdmin && (
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-2">
                                {(isAdmin ||
                                  u.role === "team_lead" ||
                                  u.role === "agent" ||
                                  u.role === "lead_generation" ||
                                  false) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEdit(u)}>
                                    Edit
                                  </Button>
                                )}
                                {isAdmin && u.$id !== user?.$id && (
                                  <>
                                    {(u.role === "agent" ||
                                      u.role === "lead_generation" ||
                                      u.role === "monitor" ||
                                      u.role === "operations") && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleSetAgentActive(
                                            u,
                                            u.isActive === false,
                                          )
                                        }
                                        disabled={activeStatusUserId === u.$id}>
                                        {activeStatusUserId === u.$id
                                          ? "Updating..."
                                          : u.isActive === false
                                            ? "Reactivate"
                                            : "Inactivate"}
                                      </Button>
                                    )}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleDeleteUser(u)}
                                      disabled={deletingUserId === u.$id}
                                      className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950/20">
                                      {deletingUserId === u.$id
                                        ? "Deleting..."
                                        : "Delete"}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server-side pagination (admin/developer/monitor/operations only) */}
      {(isAdmin || isDeveloper || isMonitor || isOperations) && usersTotal > USERS_PAGE_SIZE && (
        <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentUsersPage((p) => Math.max(1, p - 1))}
            disabled={currentUsersPage === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentUsersPage} of {Math.ceil(usersTotal / USERS_PAGE_SIZE)}
            {" "}({usersTotal} total)
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentUsersPage((p) => Math.min(Math.ceil(usersTotal / USERS_PAGE_SIZE), p + 1))
            }
            disabled={currentUsersPage >= Math.ceil(usersTotal / USERS_PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}

      {/* Create User Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>{dialogTitle}</CardTitle>
              <CardDescription>{dialogDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                )}

                <div>
                  <Label htmlFor="create-name">Name</Label>
                  <Input
                    id="create-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="John Doe"
                    className="mt-1"
                  />
                  {formErrors.name && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {formErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="create-email">Email</Label>
                  <Input
                    id="create-email"
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="john@example.com"
                    className="mt-1"
                  />
                  {formErrors.email && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {formErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="create-password">Initial Password</Label>
                  <Input
                    id="create-password"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                  {formErrors.password && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {formErrors.password}
                    </p>
                  )}
                </div>

                {/* Team Lead Selection (for Agents created by Admin) */}
                {isAdmin &&
                  (createRole === "agent" ||
                    createRole === "lead_generation") && (
                    <div>
                      <Label htmlFor="create-team-lead">Assign Team Lead</Label>
                      <div className="mt-1">
                        <select
                          id="create-team-lead"
                          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={selectedTeamLeadId || ""}
                          onChange={(e) =>
                            setSelectedTeamLeadId(e.target.value || null)
                          }>
                          <option value="">
                            Select a Team Lead (Optional)
                          </option>
                          {availableTeamLeads.map((tl) => (
                            <option key={tl.$id} value={tl.$id}>
                              {tl.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                {/* Branch multi-select */}
                {createRole !== "admin" && createRole !== "developer" && (
                  <div>
                    <Label>Branches</Label>
                    {availableBranches.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        No branches available. You need at least one assigned
                        branch.
                      </p>
                    ) : (
                      <div className="mt-1 space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                        {availableBranches.map((branch) => (
                          <label
                            key={branch.$id}
                            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={selectedBranchIds.includes(branch.$id)}
                              onChange={() => toggleBranch(branch.$id)}
                              className="rounded border-gray-300 dark:border-gray-600"
                            />
                            <span className="text-sm">{branch.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {formErrors.branches && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                        {formErrors.branches}
                      </p>
                    )}
                  </div>
                )}

                {(isAdmin || isDeveloper || isTeamLead) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canCreateAdmin && (
                      <Button
                        type="button"
                        variant={createRole === "admin" ? "default" : "outline"}
                        onClick={() => setCreateRole("admin")}
                        size="sm">
                        Admin
                      </Button>
                    )}
                    {canCreateDeveloper && (
                      <Button
                        type="button"
                        variant={createRole === "developer" ? "default" : "outline"}
                        onClick={() => setCreateRole("developer")}
                        size="sm">
                        Developer
                      </Button>
                    )}
                    {canCreateTeamLead && (
                      <Button
                        type="button"
                        variant={
                          createRole === "team_lead" ? "default" : "outline"
                        }
                        onClick={() => setCreateRole("team_lead")}
                        size="sm">
                        Team Lead
                      </Button>
                    )}
                    {canCreateAgent && (
                      <Button
                        type="button"
                        variant={createRole === "agent" ? "default" : "outline"}
                        onClick={() => setCreateRole("agent")}
                        size="sm">
                        Agent
                      </Button>
                    )}
                    {canCreateLeadGeneration && (
                      <Button
                        type="button"
                        variant={
                          createRole === "lead_generation"
                            ? "default"
                            : "outline"
                        }
                        onClick={() => setCreateRole("lead_generation")}
                        size="sm">
                        Lead Gen
                      </Button>
                    )}
                    {canCreateMonitor && (
                      <Button
                        type="button"
                        variant={createRole === "monitor" ? "default" : "outline"}
                        onClick={() => setCreateRole("monitor")}
                        size="sm">
                        Monitor
                      </Button>
                    )}
                    {canCreateOperations && (
                      <Button
                        type="button"
                        variant={createRole === "operations" ? "default" : "outline"}
                        onClick={() => setCreateRole("operations")}
                        size="sm">
                        Operations
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateDialog(false);
                      resetForm();
                    }}
                    disabled={isCreating}
                    className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreate}
                    disabled={isCreating}
                    className="w-full sm:w-auto">
                    {isCreating ? "Creating..." : createButtonLabel}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit User Dialog */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Edit User</CardTitle>
              <CardDescription>
                Update details for {editingUser.name} (
                {formatRole(editingUser.role)})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Role Selection */}
                {isAdmin && (
                  <div>
                    <Label>Role</Label>
                    <select
                      className="w-full h-10 px-3 rounded-md border border-input bg-background"
                      value={editRole || ""}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                    >
                      {(isAdmin || isDeveloper) && <option value="admin">Admin</option>}
                      {(isAdmin || isDeveloper) && <option value="developer">Developer</option>}
                      {(isAdmin || isDeveloper) && <option value="monitor">Monitor</option>}
                      {(isAdmin || isDeveloper) && <option value="operations">Operations</option>}
                      <option value="team_lead">Team Lead</option>
                      <option value="agent">Agent</option>
                      <option value="lead_generation">Lead Generation</option>
                    </select>
                  </div>
                )}

                {/* Team Lead Selection */}
                {isAdmin &&
                  (editingUser.role === "agent" ||
                    editingUser.role === "lead_generation" ||
                    editRole === "agent" ||
                    editRole === "lead_generation") && (
                    <div>
                      <Label htmlFor="edit-team-lead">Assign Team Lead</Label>
                      <div className="mt-1">
                        <select
                          id="edit-team-lead"
                          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={selectedTeamLeadId || ""}
                          onChange={(e) =>
                            setSelectedTeamLeadId(e.target.value || null)
                          }>
                          <option value="">
                            Select a Team Lead (Optional)
                          </option>
                          {availableTeamLeads.map((tl) => (
                            <option key={tl.$id} value={tl.$id}>
                              {tl.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                )}

                {/* Branch multi-select */}
                <div>
                  <Label>Branches</Label>
                  {availableBranches.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      No branches available.
                    </p>
                  ) : (
                    <div className="mt-1 space-y-2 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                      {availableBranches.map((branch) => (
                        <label
                          key={branch.$id}
                          className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedBranchIds.includes(branch.$id)}
                            onChange={() => toggleBranch(branch.$id)}
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                          <span className="text-sm">{branch.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingUser(null);
                      setSelectedBranchIds([]);
                      setError(null);
                    }}
                    disabled={isUpdating}
                    className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleUpdateUser}
                    disabled={isUpdating}
                    className="w-full sm:w-auto">
                    {isUpdating ? "Updating..." : "Update User"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}

function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("Confirm");
  const [cancelText, setCancelText] = useState("Cancel");
  const [destructive, setDestructive] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = (value: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolver?.(value);
  };

  const confirm = (options: {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
  }) => {
    setTitle(options.title);
    setDescription(options.description ?? null);
    setConfirmText(options.confirmText ?? "Confirm");
    setCancelText(options.cancelText ?? "Cancel");
    setDestructive(Boolean(options.destructive));
    setOpen(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const ConfirmDialog = () => (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) close(false);
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => close(true)}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog };
}
