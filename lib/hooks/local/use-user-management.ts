import { useCallback, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import {
  createAdminAction,
  createTeamLeadAction,
  createAgentAction,
} from "@/app/actions/user";
import { listBranches } from "@/lib/services/branch-service";
import { invalidateUsersCache } from "@/lib/services/user-service";
import { useIsVisible } from "@/lib/hooks/use-is-visible";
import { User, Branch, UserRole, Department } from "@/lib/types";
import { client, databases } from "@/lib/appwrite";

export function useUserManagement() {
  const searchParams = useSearchParams();
  const {
    user,
    isAdmin,
    isDeveloper,
    isTeamLead,
    isSeniorTL,
    isMonitor,
    isOperations,
    activeDashboard,
  } = useAuth();
  
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
  const [activeStatusUserId, setActiveStatusUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { confirm, ConfirmDialog } = useConfirmDialog();
  const isVisible = useIsVisible();

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string | null>(null);
  
  const [createDepartment, setCreateDepartment] = useState<Department>(() => activeDashboard);
  const [departmentFilter, setDepartmentFilter] = useState<"all" | Department>(
    () => (activeDashboard === "resume" ? "resume" : "all")
  );

  useEffect(() => {
    if (activeDashboard === "resume" && departmentFilter === "all") {
      setDepartmentFilter("resume");
    }
  }, [activeDashboard, departmentFilter]);

  const [editRole, setEditRole] = useState<UserRole | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDepartment, setEditDepartment] = useState<Department>("sales");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [availableTeamLeads, setAvailableTeamLeads] = useState<User[]>([]);

  const [createRole, setCreateRole] = useState<
    "admin" | "developer" | "team_lead" | "senior_tl" | "agent" | "lead_generation" | "monitor" | "operations" | "compliance"
  >("team_lead");

  useEffect(() => {
    if (isAdmin || isDeveloper) setCreateRole("admin");
    else if (isTeamLead || isSeniorTL) setCreateRole("agent");
  }, [isAdmin, isDeveloper, isTeamLead, isSeniorTL, showCreateDialog]);

  const canCreateAdmin = isAdmin || isDeveloper;
  const canCreateDeveloper = isAdmin || isDeveloper;
  const canCreateSeniorTL = isAdmin || isDeveloper;
  const canCreateTeamLead = isAdmin || isDeveloper || isSeniorTL;
  const canCreateAgent = isAdmin || isDeveloper || isTeamLead || isSeniorTL;
  const canCreateLeadGeneration = isAdmin || isDeveloper || isTeamLead || isSeniorTL;
  const canCreateMonitor = isAdmin || isDeveloper;
  const canCreateOperations = isAdmin || isDeveloper;
  const canCreateCompliance = isAdmin || isDeveloper;
  const canCreate =
    canCreateAdmin ||
    canCreateDeveloper ||
    canCreateSeniorTL ||
    canCreateTeamLead ||
    canCreateAgent ||
    canCreateLeadGeneration ||
    canCreateMonitor ||
    canCreateOperations ||
    canCreateCompliance;

  useEffect(() => {
    if (searchParams.get("action") === "create" && canCreate) {
      setShowCreateDialog(true);
    }
  }, [searchParams, canCreate]);

  const availableBranches = allBranches.filter(
    (b) => b.isActive && (isAdmin || isDeveloper || isMonitor || isOperations || (user?.branchIds ?? []).includes(b.$id))
  );

  const fetchUsers = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      if (isAdmin || isDeveloper || isMonitor || isOperations || isSeniorTL) {
        const { Query } = await import("appwrite");
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
          [
            Query.limit(USERS_PAGE_SIZE),
            Query.offset((currentUsersPage - 1) * USERS_PAGE_SIZE),
            Query.select([
              '$id', '$createdAt', '$updatedAt', 'name', 'email', 'role',
              'isActive', 'teamLeadId', 'branchIds', 'department',
            ]),
            ...(isSeniorTL && !isAdmin && !isDeveloper ? [Query.equal('department', 'resume')] : [])
          ]
        );
        const pageUsers = response.documents.map((doc: any) => ({
          $id: doc.$id,
          name: doc.name,
          email: doc.email,
          role: doc.role,
          teamLeadId: doc.teamLeadId || null,
          branchIds: doc.branchIds || [],
          isActive: doc.isActive !== false,
          branchId: doc.branchId || null,
          department: (doc.department === 'resume' ? 'resume' : 'sales') as Department,
          $createdAt: doc.$createdAt,
          $updatedAt: doc.$updatedAt,
        }));

        const roleOrder: Record<string, number> = {
          admin: 0, developer: 0, monitor: 1, operations: 1, team_lead: 2, lead_generation: 3, agent: 4,
        };

        pageUsers.sort((a: User, b: User) => {
          const roleA = roleOrder[a.role] ?? 99;
          const roleB = roleOrder[b.role] ?? 99;
          if (roleA !== roleB) return roleA - roleB;
          return a.name.localeCompare(b.name);
        });

        setUsers(pageUsers);
        setUsersTotal(response.total);
      } else if (user.role === "team_lead") {
        const { getAgentsByTeamLead } = await import("@/lib/services/user-service");
        const agentsList = await getAgentsByTeamLead(user.$id);
        setUsers(agentsList);
        setUsersTotal(agentsList.length);
      } else {
        setUsers([]);
        setUsersTotal(0);
      }
    } catch (err: any) {
      console.error("Error fetching users:", err);
      setError(err.message || "Failed to fetch users");
    } finally {
      setIsLoading(false);
    }
  }, [user, isAdmin, isDeveloper, isMonitor, isOperations, isSeniorTL, currentUsersPage]);

  const fetchTeamLeadsOnly = useCallback(async () => {
    if (!user) return;
    if (!isAdmin && !isDeveloper && !isSeniorTL) return;

    try {
      const { Query } = await import("appwrite");
      const response = await databases.listDocuments(
        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
        process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
        [
          Query.equal("role", ["team_lead", "senior_tl"]),
          Query.equal("isActive", [true]),
          ...(isSeniorTL && !isAdmin && !isDeveloper ? [Query.equal('department', 'resume')] : [])
        ]
      );
      const teamLeads = response.documents.map((doc: any) => ({
        $id: doc.$id,
        name: doc.name,
        email: doc.email,
        role: doc.role,
        teamLeadId: doc.teamLeadId || null,
        branchIds: doc.branchIds || [],
        isActive: doc.isActive !== false,
        branchId: doc.branchId || null,
        department: (doc.department === 'resume' ? 'resume' : 'sales') as Department,
        $createdAt: doc.$createdAt,
        $updatedAt: doc.$updatedAt,
      }));
      setAvailableTeamLeads(teamLeads);
    } catch (err) {
      console.error("Error fetching team leads:", err);
    }
  }, [user, isAdmin, isDeveloper, isSeniorTL]);

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
    if (user) {
      void fetchUsers();
      void fetchBranches();
      void fetchTeamLeadsOnly();
    }
  }, [user, fetchUsers, fetchTeamLeadsOnly]);

  useEffect(() => {
    if (!user || !isVisible) return;

    const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

    const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };
    const scheduleRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          databases.clearReadCache();
        } catch {}
        invalidateUsersCache();
        void fetchUsers();
      }, 250);
    };

    const unsubscribe = client.subscribe(
      `databases.${databaseId}.collections.${collectionId}.documents`,
      scheduleRefetch
    );

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unsubscribe();
    };
  }, [user, fetchUsers, isVisible]);

  useEffect(() => {
    async function loadTeamLeads() {
      const isAgentTarget =
        (showCreateDialog && (createRole === "agent" || createRole === "lead_generation" || createRole === "monitor" || createRole === "operations")) ||
        editingUser?.role === "agent" ||
        editingUser?.role === "lead_generation" ||
        editingUser?.role === "monitor" ||
        editingUser?.role === "operations";

      if (isAdmin && isAgentTarget) {
        try {
          const { getTeamLeads } = await import("@/lib/services/user-service");
          let teamLeads: User[] = [];
          if (isAdmin) {
            teamLeads = await getTeamLeads(undefined, activeDashboard);
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
  }, [showCreateDialog, editingUser, createRole, isAdmin, user, activeDashboard]);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setSelectedBranchIds([]);
    setSelectedTeamLeadId(null);
    setCreateDepartment(activeDashboard);
    setFormErrors({});
    setError(null);
  }, [activeDashboard]);

  const validateForm = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!formName.trim()) errs.name = "Name is required";
    if (!formEmail.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail))
      errs.email = "Invalid email address";
    if (!formPassword) errs.password = "Password is required";
    else if (formPassword.length < 8)
      errs.password = "Password must be at least 8 characters";
    
    if (
      createDepartment !== "resume" &&
      activeDashboard !== "resume" &&
      createRole !== "admin" &&
      createRole !== "developer" &&
      createRole !== "monitor" &&
      createRole !== "operations" &&
      createRole !== "compliance" &&
      selectedBranchIds.length === 0
    ) {
      errs.branches = "At least one branch must be selected";
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formName, formEmail, formPassword, createRole, selectedBranchIds, activeDashboard, createDepartment]);

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleEdit = useCallback((userToEdit: User) => {
    setEditingUser(userToEdit);
    setSelectedBranchIds(userToEdit.branchIds || []);
    setSelectedTeamLeadId(userToEdit.teamLeadId || null);
    setEditRole(userToEdit.role);
    setEditEmail(userToEdit.email || "");
    setEditDepartment(userToEdit.department || "sales");
    setError(null);
  }, []);

  const handleUpdateUser = useCallback(async () => {
    if (!editingUser || !user) return;

    try {
      setIsUpdating(true);
      setError(null);

      const { updateUserAction } = await import("@/app/actions/user");
      const role = (editRole as UserRole) || undefined;
      const isEditingResumeUser = (editingUser.department ?? "sales") === "resume";

      if (
        (role === "agent" || role === "lead_generation") &&
        !isEditingResumeUser &&
        !selectedTeamLeadId
      ) {
        setError("Agents must be assigned to a Team Lead");
        setIsUpdating(false);
        return;
      }

      const trimmedEmail = editEmail.trim();
      const emailChanged = trimmedEmail && trimmedEmail !== editingUser.email;
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError("Invalid email address");
        setIsUpdating(false);
        return;
      }

      await updateUserAction({
        userId: editingUser.$id,
        role,
        teamLeadId: (role === "agent" || role === "lead_generation") ? selectedTeamLeadId || null : null,
        branchIds: selectedBranchIds,
        email: emailChanged ? trimmedEmail : undefined,
        department: editDepartment,
        currentUserId: user.$id,
      });

      setEditingUser(null);
      setSelectedBranchIds([]);
      setEditEmail("");
      invalidateUsersCache();
      await fetchUsers();
    } catch (err: any) {
      console.error("Error updating user:", err);
      setError(err.message || "Failed to update user");
    } finally {
      setIsUpdating(false);
    }
  }, [editingUser, user, editRole, editEmail, selectedTeamLeadId, selectedBranchIds, fetchUsers, editDepartment]);

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
    const isCallerTL = user?.role === "team_lead";
    const canMutate = isAdmin || isDeveloper || (isCallerTL && agent.teamLeadId === user?.$id);

    if (
      !user ||
      !canMutate ||
      (agent.role !== "agent" && agent.role !== "lead_generation" && agent.role !== "monitor" && agent.role !== "operations")
    ) return;

    const confirmed = await confirm({
      title: isActive ? `Reactivate ${agent.name}?` : `Inactivate ${agent.name}?`,
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
      setError(err instanceof Error ? err.message : "Failed to update agent active status");
    } finally {
      setActiveStatusUserId(null);
    }
  }, [user, isAdmin, isDeveloper, confirm, fetchUsers]);

  const handleCreate = useCallback(async () => {
    if (!user || !validateForm()) return;

    try {
      setIsCreating(true);
      setError(null);

      if (isAdmin || isDeveloper || isSeniorTL) {
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
        } else if (createRole === "team_lead" || createRole === "senior_tl") {
          await createTeamLeadAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            branchIds: selectedBranchIds,
            department: createDepartment,
            currentUserId: user.$id,
          });
        } else {
          const isResumeTarget = createDepartment === "resume" || activeDashboard === "resume";
          if (
            createRole !== "monitor" &&
            createRole !== "operations" &&
            createRole !== "compliance" &&
            !isResumeTarget &&
            !selectedTeamLeadId
          ) {
            setError("Agents must be assigned to a Team Lead");
            setIsCreating(false);
            return;
          }

          await createAgentAction({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            role:
              createRole === "lead_generation" ? "lead_generation" :
              createRole === "monitor" ? "monitor" :
              createRole === "operations" ? "operations" :
              createRole === "compliance" ? "compliance" : "agent",
            teamLeadId: (createRole === "monitor" || createRole === "operations" || createRole === "compliance") ? undefined : selectedTeamLeadId || undefined,
            branchIds: selectedBranchIds,
            department: createDepartment,
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
          department: createDepartment,
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
    user, validateForm, isAdmin, isDeveloper, canCreateAgent, createRole,
    formName, formEmail, formPassword, selectedTeamLeadId, selectedBranchIds,
    fetchUsers, resetForm, createDepartment, activeDashboard
  ]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = users;

    const isLeadership = (role?: string) =>
      role === "admin" || role === "developer" || role === "monitor" || role === "operations";

    if (activeDashboard === "resume") {
      result = result.filter(
        (u) => (u.department ?? "sales") === "resume" || isLeadership(u.role)
      );
    } else if (activeDashboard === "sales" && departmentFilter === "all") {
      result = result.filter(
        (u) => (u.department ?? "sales") === "sales" || isLeadership(u.role)
      );
    } else if (departmentFilter !== "all") {
      result = result.filter((u) => (u.department ?? "sales") === departmentFilter);
    }

    if (query) {
      result = result.filter((u) => {
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
    }

    return result;
  }, [branchMap, search, users, departmentFilter, activeDashboard]);

  const teamLeadOptions = useMemo(() => {
    if (activeDashboard !== "resume" && createDepartment !== "resume") {
      return availableTeamLeads;
    }
    return availableTeamLeads.filter(
      (tl) => (tl.department ?? "sales") === "resume"
    );
  }, [availableTeamLeads, activeDashboard, createDepartment]);

  useEffect(() => {
    if (!selectedTeamLeadId) return;
    const stillValid = teamLeadOptions.some((tl) => tl.$id === selectedTeamLeadId);
    if (!stillValid) setSelectedTeamLeadId(null);
  }, [teamLeadOptions, selectedTeamLeadId]);

  return {
    user, isAdmin, isDeveloper, isTeamLead, isMonitor, isOperations, activeDashboard,
    users, usersTotal, currentUsersPage, setCurrentUsersPage, USERS_PAGE_SIZE,
    search, setSearch, allBranches, branchMap, isLoading, isCreating,
    showCreateDialog, setShowCreateDialog, editingUser, setEditingUser,
    isUpdating, deletingUserId, activeStatusUserId, error, setError,
    ConfirmDialog, formName, setFormName, formEmail, setFormEmail,
    formPassword, setFormPassword, selectedBranchIds, setSelectedBranchIds,
    selectedTeamLeadId, setSelectedTeamLeadId, createDepartment, setCreateDepartment,
    departmentFilter, setDepartmentFilter, editRole, setEditRole,
    editEmail, setEditEmail, editDepartment, setEditDepartment,
    formErrors, availableTeamLeads, createRole, setCreateRole,
    canCreateAdmin,
    canCreateDeveloper,
    canCreateSeniorTL,
    canCreateTeamLead,
    canCreateAgent,
    canCreateLeadGeneration, canCreateMonitor, canCreateOperations, canCreateCompliance, canCreate,
    availableBranches, toggleBranch, handleEdit, handleUpdateUser,
    handleDeleteUser, handleSetAgentActive, handleCreate, resetForm,
    filteredUsers, teamLeadOptions
  };
}
