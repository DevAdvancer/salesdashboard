"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  createAdminAction,
  createManagerAction,
  createTeamLeadAction,
  createAgentAction,
  createAssistantManagerAction,
} from "@/app/actions/user";
import {
  getUsersByBranches,
  getAgentsByManager,
} from "@/lib/services/user-service";
import { getVisibleUserBranches } from "@/lib/utils/branch-visibility";
import { listBranches } from "@/lib/services/branch-service";
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
  const { user, isManager, isAdmin, isTeamLead, isAssistantManager } =
    useAuth();
  const [users, setUsers] = useState<User[]>([]);
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
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(
    null,
  ); // Shared for Create & Edit
  const [selectedAssistantManagerIds, setSelectedAssistantManagerIds] =
    useState<string[]>([]); // New field for Multiple Assistant Managers
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]); // For Team Leads with multiple managers
  const [availableManagers, setAvailableManagers] = useState<User[]>([]);
  const [availableAssistantManagers, setAvailableAssistantManagers] = useState<
    User[]
  >([]);
  const [editRole, setEditRole] = useState<UserRole | null>(null); // Only for Edit
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [availableTeamLeads, setAvailableTeamLeads] = useState<User[]>([]);

  // Create Role State
  const isMgr = user?.role === "manager";
  const [createRole, setCreateRole] = useState<
    | "admin"
    | "manager"
    | "assistant_manager"
    | "team_lead"
    | "agent"
    | "lead_generation"
  >("team_lead");
  const [assignmentType, setAssignmentType] = useState<
    "direct" | "assistant_manager" | "team_lead"
  >("direct");

  // Initialize createRole when dialog opens or user changes
  useEffect(() => {
    if (isAdmin) setCreateRole("admin");
    else if (isMgr) setCreateRole("assistant_manager");
    else if (isAssistantManager) setCreateRole("team_lead");
    else if (isTeamLead) setCreateRole("agent");
  }, [isAdmin, isMgr, isAssistantManager, isTeamLead, showCreateDialog]);

  useEffect(() => {
    async function loadManagers() {
      if (isAdmin) {
        try {
          const { getAllManagers } =
            await import("@/lib/services/user-service");
          const mgrs = await getAllManagers();
          setAvailableManagers(mgrs);
        } catch (err) {
          console.error(err);
        }
      }
    }
    loadManagers();
  }, [isAdmin]);

  // Determine which role the current user can create
  const canCreateAdmin = isAdmin;
  const canCreateManager = isAdmin;
  const canCreateAssistantManager = isAdmin || isMgr;
  const canCreateTeamLead = isAdmin || isMgr || isAssistantManager;
  const canCreateAgent = isAdmin || isMgr || isAssistantManager || isTeamLead;
  const canCreateLeadGeneration =
    isAdmin || isMgr || isAssistantManager || isTeamLead;
  const canCreate =
    canCreateAdmin ||
    canCreateManager ||
    canCreateAssistantManager ||
    canCreateTeamLead ||
    canCreateAgent ||
    canCreateLeadGeneration;

  useEffect(() => {
    if (searchParams.get("action") === "create" && canCreate) {
      setShowCreateDialog(true);
    }
  }, [searchParams, canCreate]);

  // The branches available for assignment (subset of current user's branchIds)
  const availableBranches = allBranches.filter(
    (b) => b.isActive && (isAdmin || (user?.branchIds ?? []).includes(b.$id)),
  );

  const fetchUsers = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      if (isAdmin) {
        // Admin sees all users regardless of branches
        const { Query } = await import("appwrite");
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
          [Query.limit(100)],
        );
        const allUsers = response.documents.map((doc: any) => ({
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

        // Sort by hierarchy: Manager -> Assistant Manager -> Team Lead -> Agent
        const roleOrder: Record<string, number> = {
          manager: 0,
          assistant_manager: 1,
          team_lead: 2,
          lead_generation: 3,
          agent: 4,
        };

        allUsers.sort((a: User, b: User) => {
          const roleA = roleOrder[a.role] ?? 99;
          const roleB = roleOrder[b.role] ?? 99;
          if (roleA !== roleB) return roleA - roleB;
          return a.name.localeCompare(b.name);
        });

        setUsers(allUsers);
        setAvailableManagers(
          allUsers.filter(
            (u: User) => u.isActive !== false && u.role === "manager",
          ),
        );
        setAvailableAssistantManagers(
          allUsers.filter(
            (u: User) => u.isActive !== false && u.role === "assistant_manager",
          ),
        );
        setAvailableTeamLeads(
          allUsers.filter(
            (u: User) => u.isActive !== false && u.role === "team_lead",
          ),
        );
      } else if (user.role === "manager" && user.branchIds.length > 0) {
        const usersList = await getUsersByBranches(user.branchIds);
        // Managers should not see other managers (except themselves)
        const filteredUsers = usersList.filter(
          (u) => u.role !== "manager" || u.$id === user.$id,
        );
        setUsers(filteredUsers);
        setAvailableAssistantManagers(
          filteredUsers.filter(
            (u) => u.isActive !== false && u.role === "assistant_manager",
          ),
        );
        setAvailableTeamLeads(
          filteredUsers.filter(
            (u) => u.isActive !== false && u.role === "team_lead",
          ),
        );
        // Populate available managers with self
        setAvailableManagers([user]);
      } else if (user.role === "assistant_manager") {
        // Assistant Manager sees only their subordinates
        const { getSubordinates } = await import("@/lib/services/user-service");
        const subordinates = await getSubordinates(user.$id);
        setUsers(subordinates);
        setAvailableTeamLeads(
          subordinates.filter(
            (u) => u.isActive !== false && u.role === "team_lead",
          ),
        );
      } else if (user.role === "team_lead") {
        // Team Lead sees their agents
        const { getAgentsByTeamLead } =
          await import("@/lib/services/user-service");
        const agentsList = await getAgentsByTeamLead(user.$id);
        setUsers(agentsList);
      } else {
        // Agents see no one
        setUsers([]);
      }
    } catch (err: any) {
      console.error("Error fetching users:", err);
      setError(err.message || "Failed to fetch users");
    } finally {
      setIsLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    if (user) {
      void fetchUsers();
      void fetchBranches();
    }
  }, [user, fetchUsers]);

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
        void fetchUsers();
      },
    );

    return () => {
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
          (createRole === "agent" || createRole === "lead_generation")) ||
        editingUser?.role === "agent" ||
        editingUser?.role === "lead_generation";
      // For Admin, also load if creating Team Lead? No, Team Lead doesn't report to Team Lead.

      if ((isAdmin || isManager) && isAgentTarget) {
        try {
          const { getTeamLeads } = await import("@/lib/services/user-service");

          let teamLeads: User[] = [];
          if (isAdmin) {
            teamLeads = await getTeamLeads();
          } else if (isManager && user?.branchIds) {
            teamLeads = await getTeamLeads(user.branchIds);
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
  }, [showCreateDialog, editingUser, createRole, isAdmin, isManager, user]);

  const resetForm = () => {
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setSelectedBranchIds([]);
    setSelectedTeamLeadId(null);
    setSelectedManagerId(null);
    setSelectedAssistantManagerIds([]);
    setSelectedManagerIds([]);
    setFormErrors({});
    setError(null);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!formName.trim()) errs.name = "Name is required";
    if (!formEmail.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail))
      errs.email = "Invalid email address";
    if (!formPassword) errs.password = "Password is required";
    else if (formPassword.length < 8)
      errs.password = "Password must be at least 8 characters";
    if (createRole !== "admin" && selectedBranchIds.length === 0)
      errs.branches = "At least one branch must be selected";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId],
    );
  };

  const toggleManager = (managerId: string) => {
    setSelectedManagerIds((prev) =>
      prev.includes(managerId)
        ? prev.filter((id) => id !== managerId)
        : [...prev, managerId],
    );
  };

  const toggleAssistantManager = (amId: string) => {
    setSelectedAssistantManagerIds((prev) =>
      prev.includes(amId) ? prev.filter((id) => id !== amId) : [...prev, amId],
    );
  };

  const handleEdit = (userToEdit: User) => {
    setEditingUser(userToEdit);
    setSelectedBranchIds(userToEdit.branchIds || []);
    setSelectedTeamLeadId(userToEdit.teamLeadId || null);
    setSelectedManagerId(userToEdit.managerId || null);

    // Handle multiple Assistant Managers
    if (
      userToEdit.assistantManagerIds &&
      userToEdit.assistantManagerIds.length > 0
    ) {
      setSelectedAssistantManagerIds(userToEdit.assistantManagerIds);
    } else if (userToEdit.managerIds && userToEdit.managerIds.length > 0) {
      // Fallback: Find which of these IDs belong to Assistant Managers
      // We need the full user objects to know roles. 'users' state has them.
      const amIds = userToEdit.managerIds.filter((id) => {
        const u = users.find((u) => u.$id === id);
        return u && u.role === "assistant_manager";
      });

      // If we found some AMs via managerIds, use them.
      // Otherwise, check legacy field.
      if (amIds.length > 0) {
        setSelectedAssistantManagerIds(amIds);
      } else {
        setSelectedAssistantManagerIds(
          userToEdit.assistantManagerId ? [userToEdit.assistantManagerId] : [],
        );
      }
    } else {
      setSelectedAssistantManagerIds(
        userToEdit.assistantManagerId ? [userToEdit.assistantManagerId] : [],
      );
    }

    // Populate multiple managers for Team Lead and Assistant Manager
    if (
      userToEdit.role === "team_lead" ||
      userToEdit.role === "assistant_manager"
    ) {
      // If managerIds exists, use it. If not, use managerId (legacy).
      const existingIds =
        userToEdit.managerIds && userToEdit.managerIds.length > 0
          ? userToEdit.managerIds
          : userToEdit.managerId
            ? [userToEdit.managerId]
            : [];
      setSelectedManagerIds(existingIds);

      // For Team Lead editing: Set selectedManagerId from the primary manager in the list (usually first or not AM)
      if (userToEdit.role === "team_lead") {
        // Find the manager that is NOT an assistant manager
        // We use the users list to check roles of IDs in managerIds
        const primaryManager = existingIds.find((id) => {
          const u = users.find((user) => user.$id === id);
          return u && u.role === "manager";
        });

        if (primaryManager) setSelectedManagerId(primaryManager);
        else if (userToEdit.managerId)
          setSelectedManagerId(userToEdit.managerId); // Fallback
      }
    } else {
      setSelectedManagerIds([]);
    }
    setEditRole(userToEdit.role);
    setError(null);
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !user) return;

    try {
      setIsUpdating(true);
      setError(null);

      const { updateUserAction } = await import("@/app/actions/user");

      const role = (editRole as UserRole) || undefined;

      // Validate hierarchy consistency
      // Team Leads and Assistant Managers use selectedManagerIds (multiple)
      if (
        role === "assistant_manager" &&
        (!selectedManagerIds || selectedManagerIds.length === 0)
      ) {
        setError("Assistant Managers must have at least one Manager assigned");
        setIsUpdating(false);
        return;
      }

      if (
        role === "team_lead" &&
        !selectedManagerId &&
        (availableManagers.length > 0 || !isAdmin)
      ) {
        setError(
          "Team Leads must have a primary Manager assigned unless no Managers exist",
        );
        setIsUpdating(false);
        return;
      }

      if (
        role === "agent" &&
        availableManagers.length === 0 &&
        !selectedTeamLeadId
      ) {
        setError(
          "Agents must be assigned to a Team Lead when no Managers exist",
        );
        setIsUpdating(false);
        return;
      }

      // Construct managerIds for Team Lead update
      let finalManagerIds = selectedManagerIds;
      if (role === "team_lead") {
        finalManagerIds = [];
        if (selectedManagerId) finalManagerIds.push(selectedManagerId);
        // Add all selected Assistant Managers
        finalManagerIds.push(...selectedAssistantManagerIds);
      }

      await updateUserAction({
        userId: editingUser.$id,
        role,
        managerId:
          role === "team_lead" || role === "assistant_manager"
            ? role === "team_lead"
              ? selectedManagerId
              : selectedManagerIds[0]
            : selectedManagerId,
        managerIds:
          role === "team_lead" || role === "assistant_manager"
            ? finalManagerIds
            : undefined,
        assistantManagerId:
          role === "team_lead" && selectedAssistantManagerIds.length > 0
            ? selectedAssistantManagerIds[0]
            : undefined, // Deprecated single field, use first one
        assistantManagerIds:
          role === "team_lead" ? selectedAssistantManagerIds : undefined, // New array field
        teamLeadId: selectedTeamLeadId,
        branchIds: selectedBranchIds,
        currentUserId: user.$id,
      });

      setEditingUser(null);
      setSelectedBranchIds([]);
      await fetchUsers();
    } catch (err: any) {
      console.error("Error updating user:", err);
      setError(err.message || "Failed to update user");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteUser = async (userToDelete: User) => {
    if (!user || !isAdmin || userToDelete.$id === user.$id) return;

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

      await fetchUsers();
    } catch (err: unknown) {
      console.error("Error deleting user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleSetAgentActive = async (agent: User, isActive: boolean) => {
    if (
      !user ||
      !isAdmin ||
      (agent.role !== "agent" && agent.role !== "lead_generation")
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
  };

  const handleCreate = async () => {
    if (!user || !validateForm()) return;

    try {
      setIsCreating(true);
      setError(null);

      if (isAdmin) {
        if (createRole === "admin") {
          await createAdminAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            currentUserId: user.$id,
          });
        } else if (createRole === "manager") {
          await createManagerAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        } else if (createRole === "assistant_manager") {
          await createAssistantManagerAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            managerIds: selectedManagerIds, // Now using multiple IDs
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        } else if (createRole === "team_lead") {
          // Construct managerIds for Team Lead
          const tlManagerIds: string[] = [];
          if (selectedManagerId) tlManagerIds.push(selectedManagerId);
          if (selectedAssistantManagerIds.length > 0)
            tlManagerIds.push(...selectedAssistantManagerIds);

          if (tlManagerIds.length === 0 && availableManagers.length > 0) {
            setError(
              "Team Lead must have at least one Manager assigned unless no Managers exist",
            );
            setIsCreating(false);
            return;
          }

          await createTeamLeadAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            // Use managerIds for Team Lead
            managerIds: tlManagerIds,
            assistantManagerId:
              selectedAssistantManagerIds.length > 0
                ? selectedAssistantManagerIds[0]
                : undefined,
            assistantManagerIds: selectedAssistantManagerIds,
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        } else {
          if (availableManagers.length === 0 && !selectedTeamLeadId) {
            setError(
              "Agents must be assigned to a Team Lead when no Managers exist",
            );
            setIsCreating(false);
            return;
          }

          await createAgentAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            role:
              createRole === "lead_generation" ? "lead_generation" : "agent",
            teamLeadId: selectedTeamLeadId || undefined,
            managerId: selectedManagerId || undefined, // Admin can assign manager
            branchIds: selectedBranchIds,
            currentUserId: user.$id,
          });
        }
      } else if (canCreateTeamLead) {
        if (
          (user.role === "manager" || user.role === "assistant_manager") &&
          (createRole === "agent" || createRole === "lead_generation")
        ) {
          await createAgentAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            role:
              createRole === "lead_generation" ? "lead_generation" : "agent",
            branchIds: selectedBranchIds,
            teamLeadId: selectedTeamLeadId || undefined,
            managerId: selectedManagerId || undefined,
            currentUserId: user.$id,
          });
        } else {
          await createTeamLeadAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            managerIds: [user.$id], // Updated from managerId to managerIds
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
      await fetchUsers();
    } catch (err: any) {
      console.error("Error creating user:", err);
      setError(err.message || "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    manager: "Manager",
    assistant_manager: "Assistant Manager",
    team_lead: "Team Lead",
    agent: "Agent",
    lead_generation: "Lead Generation",
  };
  const createButtonLabel = `Create ${roleLabels[createRole] || "User"}`;
  const dialogTitle = `Create New ${roleLabels[createRole] || "User"}`;

  const dialogDescription = isAdmin
    ? "Add a new user and assign them to branches"
    : "Add a new team member and assign them to your branches";

  const formatRole = (role: string) => {
    switch (role) {
      case "admin":
        return "Admin";
      case "manager":
        return "Manager";
      case "assistant_manager":
        return "Assistant Manager";
      case "team_lead":
        return "Team Lead";
      case "agent":
        return "Agent";
      case "lead_generation":
        return "Lead Generation";
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

    if (hasVisibilityMismatch && (isAdmin || isMgr)) {
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
                {canCreate
                  ? `Create your first ${canCreateManager ? "manager" : canCreateTeamLead ? "team lead" : "agent"} to get started.`
                  : ""}
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
                        {(isAdmin || isManager) && (
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
                          {(isAdmin || isManager) && (
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-2">
                                {(isAdmin ||
                                  u.role === "team_lead" ||
                                  u.role === "agent" ||
                                  u.role === "lead_generation" ||
                                  (user?.role === "manager" &&
                                    u.role === "assistant_manager")) && (
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
                                      u.role === "lead_generation") && (
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

                {/* Manager Selection (For Admin Creating AM/TL/Agent) */}
                {isAdmin &&
                  (createRole === "assistant_manager" ||
                    createRole === "team_lead" ||
                    createRole === "agent" ||
                    createRole === "lead_generation") && (
                    <div>
                      <Label htmlFor="create-manager">Assign Manager</Label>
                      <div className="mt-1">
                        {createRole === "assistant_manager" ? (
                          // AMs can be assigned to Managers (Multiple)
                          <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                            {availableManagers.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No managers available.
                              </p>
                            ) : (
                              <>
                                {availableManagers.map((m) => (
                                  <label
                                    key={m.$id}
                                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                                    <input
                                      type="checkbox"
                                      checked={selectedManagerIds.includes(
                                        m.$id,
                                      )}
                                      onChange={() => toggleManager(m.$id)}
                                      className="rounded border-gray-300 dark:border-gray-600"
                                    />
                                    <span className="text-sm">
                                      {m.name} (Manager)
                                    </span>
                                  </label>
                                ))}
                              </>
                            )}
                          </div>
                        ) : createRole === "team_lead" ? (
                          // Team Leads: Assign Manager (Required) + Assistant Manager (Optional)
                          <div className="space-y-4">
                            <div>
                              <Label
                                htmlFor="create-tl-manager"
                                className="text-xs text-muted-foreground mb-1 block">
                                Primary Manager{" "}
                                {availableManagers.length > 0
                                  ? "(Required)"
                                  : "(Optional until a Manager exists)"}
                              </Label>
                              <select
                                id="create-tl-manager"
                                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                value={selectedManagerId || ""}
                                onChange={(e) =>
                                  setSelectedManagerId(e.target.value || null)
                                }>
                                <option value="">
                                  {availableManagers.length > 0
                                    ? "Select Manager"
                                    : "No Manager"}
                                </option>
                                {availableManagers.map((m) => (
                                  <option key={m.$id} value={m.$id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <Label
                                htmlFor="create-tl-am"
                                className="text-xs text-muted-foreground mb-1 block">
                                Assistant Managers (Optional)
                              </Label>
                              {availableAssistantManagers.length === 0 ? (
                                <p className="text-sm text-gray-500">
                                  No Assistant Managers available
                                </p>
                              ) : (
                                <div className="mt-1 space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                                  {availableAssistantManagers.map((am) => (
                                    <label
                                      key={am.$id}
                                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                                      <input
                                        type="checkbox"
                                        checked={selectedAssistantManagerIds.includes(
                                          am.$id,
                                        )}
                                        onChange={() =>
                                          toggleAssistantManager(am.$id)
                                        }
                                        className="rounded border-gray-300 dark:border-gray-600"
                                      />
                                      <span className="text-sm">{am.name}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          // Agent can be assigned to a Manager (if direct report)
                          <select
                            id="create-manager"
                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            value={selectedManagerId || ""}
                            onChange={(e) =>
                              setSelectedManagerId(e.target.value || null)
                            }>
                            <option value="">
                              Select a Manager (Optional)
                            </option>
                            {availableManagers.map((m) => (
                              <option key={m.$id} value={m.$id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )}

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

                {/* Manager Assignment Logic (Direct, AM, or TL) */}
                {(isMgr || isAssistantManager) &&
                  (createRole === "agent" ||
                    createRole === "lead_generation") && (
                    <div className="space-y-4 pt-2 pb-2 border-t border-b border-gray-100 dark:border-gray-800">
                      <Label className="text-base font-medium">
                        Assignment Type
                      </Label>
                      <div className="flex flex-col space-y-3 pl-1">
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="radio"
                            name="assignmentType"
                            value="direct"
                            checked={assignmentType === "direct"}
                            onChange={() => {
                              setAssignmentType("direct");
                              setSelectedManagerId(null);
                              setSelectedTeamLeadId(null);
                            }}
                            className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                          />
                          <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Direct Report (Assign to Me)
                          </span>
                        </label>
                        {isMgr && (
                          <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                              type="radio"
                              name="assignmentType"
                              value="assistant_manager"
                              checked={assignmentType === "assistant_manager"}
                              onChange={() => {
                                setAssignmentType("assistant_manager");
                                setSelectedManagerId(null);
                                setSelectedTeamLeadId(null);
                              }}
                              className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                              Assign to Assistant Manager
                            </span>
                          </label>
                        )}
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="radio"
                            name="assignmentType"
                            value="team_lead"
                            checked={assignmentType === "team_lead"}
                            onChange={() => {
                              setAssignmentType("team_lead");
                              setSelectedManagerId(null);
                              setSelectedTeamLeadId(null);
                            }}
                            className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                          />
                          <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Assign to Team Lead
                          </span>
                        </label>
                      </div>

                      {assignmentType === "assistant_manager" && (
                        <div className="pl-7">
                          <Label
                            htmlFor="assign-am"
                            className="text-xs text-muted-foreground mb-1 block">
                            Select Assistant Manager
                          </Label>
                          <select
                            id="assign-am"
                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            value={selectedManagerId || ""}
                            onChange={(e) =>
                              setSelectedManagerId(e.target.value || null)
                            }>
                            <option value="">Select Assistant Manager</option>
                            {availableAssistantManagers.length === 0 ? (
                              <option disabled>
                                No Assistant Managers available
                              </option>
                            ) : (
                              availableAssistantManagers.map((am) => (
                                <option key={am.$id} value={am.$id}>
                                  {am.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      )}

                      {assignmentType === "team_lead" && (
                        <div className="pl-7">
                          <Label
                            htmlFor="assign-tl"
                            className="text-xs text-muted-foreground mb-1 block">
                            Select Team Lead
                          </Label>
                          <select
                            id="assign-tl"
                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            value={selectedTeamLeadId || ""}
                            onChange={(e) =>
                              setSelectedTeamLeadId(e.target.value || null)
                            }>
                            <option value="">Select Team Lead</option>
                            {availableTeamLeads.length === 0 ? (
                              <option disabled>No Team Leads available</option>
                            ) : (
                              availableTeamLeads.map((tl) => (
                                <option key={tl.$id} value={tl.$id}>
                                  {tl.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                {/* Branch multi-select */}
                {createRole !== "admin" && (
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

                {(isAdmin || isMgr || isAssistantManager || isTeamLead) && (
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
                    {canCreateManager && (
                      <Button
                        type="button"
                        variant={
                          createRole === "manager" ? "default" : "outline"
                        }
                        onClick={() => setCreateRole("manager")}
                        size="sm">
                        Manager
                      </Button>
                    )}
                    {canCreateAssistantManager && (
                      <Button
                        type="button"
                        variant={
                          createRole === "assistant_manager"
                            ? "default"
                            : "outline"
                        }
                        onClick={() => setCreateRole("assistant_manager")}
                        size="sm">
                        Asst. Mgr
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
                    {isCreating
                      ? "Creating..."
                      : isMgr
                        ? createRole === "team_lead"
                          ? "Create Team Lead"
                          : createRole === "lead_generation"
                            ? "Create Lead Gen"
                            : "Create Agent"
                        : isTeamLead
                          ? createRole === "lead_generation"
                            ? "Create Lead Gen"
                            : "Create Agent"
                          : createButtonLabel}
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
                {/* Role Selection (Admin or Manager promoting Agent) */}
                {(isAdmin || (isManager && editingUser.role === "agent")) && (
                  <div>
                    <Label>Role</Label>
                    <select
                      className="w-full h-10 px-3 rounded-md border border-input bg-background"
                      value={editRole || ""}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      disabled={
                        isManager &&
                        editRole === "team_lead" &&
                        editingUser.role === "team_lead"
                      } // Prevent Manager from demoting TL back to Agent if not desired? Or just allow switching.
                      // Actually, for Manager: can only promote Agent to Team Lead.
                      // If user is already Agent, allow switching to Team Lead.
                      // If user is already Team Lead, Manager can see them but maybe not change role back?
                      // Requirement says "manager can manage the agent can be prooted to a team lead".
                    >
                      {isAdmin && <option value="admin">Admin</option>}
                      {isAdmin && <option value="manager">Manager</option>}
                      <option value="assistant_manager">
                        Assistant Manager
                      </option>
                      <option value="team_lead">Team Lead</option>
                      <option value="agent">Agent</option>
                      <option value="lead_generation">Lead Generation</option>
                    </select>
                  </div>
                )}

                {/* Manager Selection (For Assistant Managers/Team Leads/Agents when Admin is editing) */}
                {(isAdmin || isManager) &&
                  (editRole === "assistant_manager" ||
                    editRole === "team_lead" ||
                    editRole === "agent" ||
                    editRole === "lead_generation") && (
                    <div>
                      <Label>Assign Manager</Label>
                      {editRole === "assistant_manager" ? (
                        <div className="mt-1 space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                          {availableManagers.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No managers available.
                            </p>
                          ) : (
                            <>
                              {availableManagers.map((m) => (
                                <label
                                  key={m.$id}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                                  <input
                                    type="checkbox"
                                    checked={selectedManagerIds.includes(m.$id)}
                                    onChange={() => toggleManager(m.$id)}
                                    className="rounded border-gray-300 dark:border-gray-600"
                                  />
                                  <span className="text-sm">
                                    {m.name} (Manager)
                                  </span>
                                </label>
                              ))}
                            </>
                          )}
                        </div>
                      ) : editRole === "team_lead" ? (
                        // Team Leads: Assign Manager (Required) + Assistant Manager (Optional)
                        <div className="space-y-4 mt-1">
                          <div>
                            <Label
                              htmlFor="edit-tl-manager"
                              className="text-xs text-muted-foreground mb-1 block">
                              Primary Manager{" "}
                              {availableManagers.length > 0
                                ? "(Required)"
                                : "(Optional until a Manager exists)"}
                            </Label>
                            <select
                              id="edit-tl-manager"
                              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              value={selectedManagerId || ""}
                              onChange={(e) =>
                                setSelectedManagerId(e.target.value || null)
                              }>
                              <option value="">
                                {availableManagers.length > 0
                                  ? "Select Manager"
                                  : "No Manager"}
                              </option>
                              {availableManagers.map((m) => (
                                <option key={m.$id} value={m.$id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <Label
                              htmlFor="edit-tl-am"
                              className="text-xs text-muted-foreground mb-1 block">
                              Assistant Managers (Optional)
                            </Label>
                            {availableAssistantManagers.length === 0 ? (
                              <p className="text-sm text-gray-500">
                                No Assistant Managers available
                              </p>
                            ) : (
                              <div className="mt-1 space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                                {availableAssistantManagers.map((am) => (
                                  <label
                                    key={am.$id}
                                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded">
                                    <input
                                      type="checkbox"
                                      checked={selectedAssistantManagerIds.includes(
                                        am.$id,
                                      )}
                                      onChange={() =>
                                        toggleAssistantManager(am.$id)
                                      }
                                      className="rounded border-gray-300 dark:border-gray-600"
                                    />
                                    <span className="text-sm">{am.name}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        // For Agent (assigned to Manager)
                        // If it's an Agent, allow selecting Manager OR Assistant Manager
                        <div className="mt-1">
                          {(editRole === "agent" ||
                            editRole === "lead_generation") &&
                          isManager ? (
                            // Manager editing Agent: Can assign to self (Manager) or Assistant Manager
                            <select
                              className="w-full h-10 px-3 rounded-md border border-input bg-background"
                              value={selectedManagerId || ""}
                              onChange={(e) =>
                                setSelectedManagerId(e.target.value || null)
                              }>
                              <option value="">
                                Select Manager / Asst. Manager
                              </option>
                              {/* Option for current manager (Self) */}
                              <option value={user?.$id}>
                                Direct Report (Me)
                              </option>

                              {/* Other Managers (if admin/visible) - usually filtered out for Manager role but good to have if data exists */}
                              {availableManagers
                                .filter((m) => m.$id !== user?.$id)
                                .map((m) => (
                                  <option key={m.$id} value={m.$id}>
                                    {m.name} (Manager)
                                  </option>
                                ))}

                              {/* Assistant Managers */}
                              {availableAssistantManagers.length > 0 && (
                                <optgroup label="Assistant Managers">
                                  {availableAssistantManagers.map((am) => (
                                    <option key={am.$id} value={am.$id}>
                                      {am.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          ) : (
                            // Admin editing or other cases
                            <select
                              className="w-full h-10 px-3 rounded-md border border-input bg-background"
                              value={selectedManagerId || ""}
                              onChange={(e) =>
                                setSelectedManagerId(e.target.value || null)
                              }>
                              <option value="">Select Manager</option>
                              {availableManagers.map((m) => (
                                <option key={m.$id} value={m.$id}>
                                  {m.name}
                                </option>
                              ))}
                              {/* Also allow Assistant Managers for Agents if Admin is editing */}
                              {(editRole === "agent" ||
                                editRole === "lead_generation") &&
                                availableAssistantManagers.length > 0 && (
                                  <optgroup label="Assistant Managers">
                                    {availableAssistantManagers.map((am) => (
                                      <option key={am.$id} value={am.$id}>
                                        {am.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                {/* Team Lead Selection */}
                {(isAdmin || isMgr || isAssistantManager) &&
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
