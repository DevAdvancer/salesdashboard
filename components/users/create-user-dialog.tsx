import { User, Branch, Department } from "@/lib/types";
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

interface CreateUserDialogProps {
  showCreateDialog: boolean;
  setShowCreateDialog: (show: boolean) => void;
  error: string | null;
  formName: string;
  setFormName: (name: string) => void;
  formEmail: string;
  setFormEmail: (email: string) => void;
  formPassword: string;
  setFormPassword: (password: string) => void;
  formErrors: Record<string, string>;
  createRole: string;
  setCreateRole: (role: "admin" | "developer" | "team_lead" | "agent" | "lead_generation" | "monitor" | "operations" | "compliance") => void;
  canCreateAdmin: boolean;
  canCreateDeveloper: boolean;
  canCreateTeamLead: boolean;
  canCreateAgent: boolean;
  canCreateLeadGeneration: boolean;
  canCreateMonitor: boolean;
  canCreateOperations: boolean;
  canCreateCompliance: boolean;
  isAdmin: boolean;
  isDeveloper: boolean;
  isTeamLead: boolean;
  activeDashboard: Department;
  createDepartment: Department;
  teamLeadOptions: User[];
  selectedTeamLeadId: string | null;
  setSelectedTeamLeadId: (id: string | null) => void;
  availableBranches: Branch[];
  selectedBranchIds: string[];
  toggleBranch: (id: string) => void;
  isCreating: boolean;
  handleCreate: () => void;
  resetForm: () => void;
  dialogTitle: string;
  dialogDescription: string;
  createButtonLabel: string;
}

export function CreateUserDialog({
  showCreateDialog,
  setShowCreateDialog,
  error,
  formName,
  setFormName,
  formEmail,
  setFormEmail,
  formPassword,
  setFormPassword,
  formErrors,
  createRole,
  setCreateRole,
  canCreateAdmin,
  canCreateDeveloper,
  canCreateTeamLead,
  canCreateAgent,
  canCreateLeadGeneration,
  canCreateMonitor,
  canCreateOperations,
  canCreateCompliance,
  isAdmin,
  isDeveloper,
  isTeamLead,
  activeDashboard,
  createDepartment,
  teamLeadOptions,
  selectedTeamLeadId,
  setSelectedTeamLeadId,
  availableBranches,
  selectedBranchIds,
  toggleBranch,
  isCreating,
  handleCreate,
  resetForm,
  dialogTitle,
  dialogDescription,
  createButtonLabel,
}: CreateUserDialogProps) {
  if (!showCreateDialog) return null;

  return (
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

            {(isAdmin || isDeveloper) &&
              (createRole === "team_lead" ||
                createRole === "agent" ||
                createRole === "lead_generation") &&
              activeDashboard === "sales" && (
                <div>
                  <Label>Department</Label>
                  <div className="mt-1 inline-flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm font-medium">
                    Sales team
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    New users created from the Sales view are added to
                    the Sales team. Switch to the Resume dashboard to
                    add Resume-team members.
                  </p>
                </div>
              )}

            {(isAdmin || isDeveloper) &&
              (createRole === "team_lead" ||
                createRole === "agent" ||
                createRole === "lead_generation") &&
              activeDashboard === "resume" && (
                <div>
                  <Label>Department</Label>
                  <div className="mt-1 inline-flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm font-medium">
                    Resume team
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    New users created from the Resume view are added to
                    the Resume team. Switch to the Sales dashboard to
                    add Sales-team members.
                  </p>
                </div>
              )}

            {isAdmin &&
              (createRole === "agent" ||
                createRole === "lead_generation") && (
                <div>
                  <Label htmlFor="create-team-lead">Assign Team Lead</Label>
                  <div className="mt-1">
                    <select
                      id="create-team-lead"
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

            {createRole !== "admin" &&
              createRole !== "developer" &&
              (createRole === "team_lead" || (createDepartment !== "resume" && activeDashboard !== "resume")) && (
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
                {canCreateLeadGeneration &&
                  activeDashboard !== "resume" &&
                  createDepartment !== "resume" && (
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
                {canCreateCompliance && (
                  <Button
                    type="button"
                    variant={createRole === "compliance" ? "default" : "outline"}
                    onClick={() => setCreateRole("compliance")}
                    size="sm">
                    Compliance
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
                loading={isCreating}
                disabled={isCreating}
                className="w-full sm:w-auto">
                {createButtonLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
