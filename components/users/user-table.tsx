import { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getVisibleUserBranches } from "@/lib/utils/branch-visibility";

interface UserTableProps {
  filteredUsers: User[];
  isLoading: boolean;
  canCreate: boolean;
  activeDashboard: string;
  isAdmin: boolean;
  isDeveloper: boolean;
  isTeamLead: boolean;
  isMonitor: boolean;
  isOperations: boolean;
  user: User | null;
  branchMap: Map<string, string>;
  search: string;
  setSearch: (val: string) => void;
  handleEdit: (u: User) => void;
  handleSetAgentActive: (u: User, isActive: boolean) => void;
  handleDeleteUser: (u: User) => void;
  activeStatusUserId: string | null;
  deletingUserId: string | null;
  currentUsersPage: number;
  setCurrentUsersPage: (val: number | ((prev: number) => number)) => void;
  usersTotal: number;
  USERS_PAGE_SIZE: number;
}

export function UserTable({
  filteredUsers,
  isLoading,
  canCreate,
  activeDashboard,
  isAdmin,
  isDeveloper,
  isTeamLead,
  isMonitor,
  isOperations,
  user,
  branchMap,
  search,
  setSearch,
  handleEdit,
  handleSetAgentActive,
  handleDeleteUser,
  activeStatusUserId,
  deletingUserId,
  currentUsersPage,
  setCurrentUsersPage,
  usersTotal,
  USERS_PAGE_SIZE,
}: UserTableProps) {
  const formatRole = (role: string) => {
    switch (role) {
      case "admin": return "Admin";
      case "developer": return "Developer";
      case "senior_tl": return "Senior TL";
      case "team_lead": return "Team Lead";
      case "agent": return "Agent";
      case "lead_generation": return "Lead Generation";
      case "monitor": return "Monitor";
      case "operations": return "Operations";
      case "compliance": return "Compliance";
      default: return role;
    }
  };

  const formatBranches = (targetUserBranchIds: string[]) => {
    if (!targetUserBranchIds || targetUserBranchIds.length === 0) return "—";

    const { visibleBranchIds, hasVisibilityMismatch } = getVisibleUserBranches(
      targetUserBranchIds,
      user?.role || "agent",
      user?.branchIds || [],
      (msg, meta) => console.warn(`[BranchVisibility] ${msg}`, meta)
    );

    const branchNames = visibleBranchIds
      .map((id) => branchMap.get(id) || id)
      .join(", ");

    if (hasVisibilityMismatch && isAdmin) {
      return branchNames || "—";
    }

    return branchNames || "—";
  };

  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
        </div>
      ) : filteredUsers.length === 0 && search === "" ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">
            No users found. {canCreate ? "Create your first user to get started." : ""}
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
                {activeDashboard === "resume"
                  ? "No Resume-team or leadership users match your search."
                  : "No Sales-team or leadership users match your search."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 font-semibold">Name</th>
                    <th className="text-left py-3 px-4 font-semibold">Email</th>
                    <th className="text-left py-3 px-4 font-semibold">Role</th>
                    <th className="text-left py-3 px-4 font-semibold">Status</th>
                    <th className="text-left py-3 px-4 font-semibold">Branches</th>
                    <th className="text-left py-3 px-4 font-semibold">Created</th>
                    {(isAdmin || isDeveloper || isTeamLead) && (
                      <th className="text-left py-3 px-4 font-semibold">Actions</th>
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
                      <td className="py-3 px-4">{formatBranches(u.branchIds)}</td>
                      <td className="py-3 px-4">
                        {u.$createdAt
                          ? new Date(u.$createdAt).toLocaleDateString()
                          : "N/A"}
                      </td>
                      {(isAdmin || isDeveloper || isTeamLead) && (
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
                            {u.$id !== user?.$id && (
                              <>
                                {(isAdmin || isDeveloper || (isTeamLead && u.teamLeadId === user?.$id)) &&
                                  (u.role === "agent" ||
                                    u.role === "lead_generation" ||
                                    u.role === "monitor" ||
                                    u.role === "operations") && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleSetAgentActive(u, u.isActive === false)}
                                      loading={activeStatusUserId === u.$id}
                                      disabled={activeStatusUserId === u.$id}>
                                      {u.isActive === false ? "Reactivate" : "Inactivate"}
                                    </Button>
                                  )}
                                {(isAdmin || isDeveloper) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteUser(u)}
                                    loading={deletingUserId === u.$id}
                                    disabled={deletingUserId === u.$id}
                                    className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950/20">
                                    Delete
                                  </Button>
                                )}
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
            onClick={() => setCurrentUsersPage((p) => Math.min(Math.ceil(usersTotal / USERS_PAGE_SIZE), p + 1))}
            disabled={currentUsersPage >= Math.ceil(usersTotal / USERS_PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
