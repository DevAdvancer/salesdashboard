import { User, Branch, Department, UserRole } from "@/lib/types";
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

interface EditUserDialogProps {
  editingUser: User | null;
  setEditingUser: (user: User | null) => void;
  error: string | null;
  setError: (error: string | null) => void;
  isAdmin: boolean;
  isDeveloper: boolean;
  editRole: UserRole | null;
  setEditRole: (role: UserRole | null) => void;
  editEmail: string;
  setEditEmail: (email: string) => void;
  editDepartment: Department;
  setEditDepartment: (dept: Department) => void;
  teamLeadOptions: User[];
  selectedTeamLeadId: string | null;
  setSelectedTeamLeadId: (id: string | null) => void;
  availableBranches: Branch[];
  selectedBranchIds: string[];
  toggleBranch: (id: string) => void;
  isUpdating: boolean;
  handleUpdateUser: () => void;
  setSelectedBranchIds: (ids: string[]) => void;
}

export function EditUserDialog({
  editingUser,
  setEditingUser,
  error,
  setError,
  isAdmin,
  isDeveloper,
  editRole,
  setEditRole,
  editEmail,
  setEditEmail,
  editDepartment,
  setEditDepartment,
  teamLeadOptions,
  selectedTeamLeadId,
  setSelectedTeamLeadId,
  availableBranches,
  selectedBranchIds,
  toggleBranch,
  isUpdating,
  handleUpdateUser,
  setSelectedBranchIds,
}: EditUserDialogProps) {
  if (!editingUser) return null;

  const formatRole = (role: string) => {
    switch (role) {
      case "admin": return "Admin";
      case "developer": return "Developer";
      case "team_lead": return "Team Lead";
      case "agent": return "Agent";
      case "lead_generation": return "Lead Generation";
      case "monitor": return "Monitor";
      case "operations": return "Operations";
      default: return role;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
        <CardHeader>
          <CardTitle>Edit User</CardTitle>
          <CardDescription>
            Update details for {editingUser.name} ({formatRole(editingUser.role)})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isAdmin && (
              <div>
                <Label>Role</Label>
                <select
                  className="w-full h-10 pl-3 pr-8 rounded-md border border-input bg-background"
                  value={editRole || ""}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                >
                  {(isAdmin || isDeveloper) && <option value="admin">Admin</option>}
                  {(isAdmin || isDeveloper) && <option value="developer">Developer</option>}
                  {(isAdmin || isDeveloper) && <option value="monitor">Monitor</option>}
                  {(isAdmin || isDeveloper) && <option value="operations">Operations</option>}
                  <option value="team_lead">Team Lead</option>
                  <option value="agent">Agent</option>
                  {editDepartment !== "resume" && (
                    <option value="lead_generation">Lead Generation</option>
                  )}
                </select>
              </div>
            )}

            {(isAdmin || isDeveloper) && (
              <div>
                <Label htmlFor="edit-email">Email (Login ID)</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Changing this updates the user's Appwrite login email.
                </p>
              </div>
            )}

            {(isAdmin || isDeveloper) &&
              editRole !== "admin" &&
              editRole !== "developer" &&
              editRole !== "monitor" &&
              editRole !== "operations" && (
                <div>
                  <Label htmlFor="edit-department">Department</Label>
                  <select
                    id="edit-department"
                    className="mt-1 w-full h-10 pl-3 pr-8 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={editDepartment}
                    onChange={(e) =>
                      setEditDepartment(e.target.value as Department)
                    }>
                    <option value="sales">Sales</option>
                    <option value="resume">Resume</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sales users land on the main dashboard; Resume users
                    land on the Resume team dashboard.
                  </p>
                </div>
              )}

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
                      className="w-full h-10 pl-3 pr-8 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedTeamLeadId || ""}
                      onChange={(e) =>
                        setSelectedTeamLeadId(e.target.value || null)
                      }>
                      <option value="">
                        Select a Team Lead (Optional)
                      </option>
                      {teamLeadOptions.map((tl) => (
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
                  setEditEmail("");
                  setEditDepartment("sales");
                  setError(null);
                }}
                disabled={isUpdating}
                className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUpdateUser}
                loading={isUpdating}
                disabled={isUpdating}
                className="w-full sm:w-auto">
                Update User
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
