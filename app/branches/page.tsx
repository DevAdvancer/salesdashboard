"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getBranchStats,
} from "@/lib/services/branch-service";
import {
  getUsersByBranch,
  removeUserFromBranch,
} from "@/lib/services/user-service";
import { Branch, User } from "@/lib/types";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ProtectedRoute } from "@/components/protected-route";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";

const branchNameSchema = z.object({
  name: z
    .string()
    .min(1, "Branch name is required")
    .max(128, "Branch name is too long"),
});

type BranchNameForm = z.infer<typeof branchNameSchema>;

interface BranchWithStats extends Branch {
  leadCount: number;
}

export default function BranchManagementPage() {
  return (
    <ProtectedRoute componentKey="branch-management">
      <BranchManagementContent />
    </ProtectedRoute>
  );
}

function BranchManagementContent() {
  const { user, isAdmin, isMonitor } = useAuth();
  const [branches, setBranches] = useState<BranchWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-row delete in-flight state. Prevents rapid double-clicks on the
  // Delete button from firing two deleteBranch() calls.
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null);
  // Per-row active/inactive toggle in-flight state.
  const [togglingBranchId, setTogglingBranchId] = useState<string | null>(null);
  // Per-row team-lead removal in-flight state.
  const [removingTeamLeadId, setRemovingTeamLeadId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Team Leads grouped by branch id
  const [branchTeamLeads, setBranchTeamLeads] = useState<Record<string, User[]>>(
    {},
  );

  const createForm = useForm<BranchNameForm>({
    resolver: zodResolver(branchNameSchema),
  });

  const editForm = useForm<BranchNameForm>({
    resolver: zodResolver(branchNameSchema),
  });

  const fetchBranches = useCallback(async () => {
    try {
      setIsLoading(true);
      const branchList = await listBranches();

      const branchesWithStats = await Promise.all(
        branchList.map(async (branch) => {
          try {
            const stats = await getBranchStats(branch.$id);
            return {
              ...branch,
              leadCount: stats.leadCount,
            };
          } catch {
            return { ...branch, leadCount: 0 };
          }
        }),
      );

      setBranches(branchesWithStats);
    } catch (err: any) {
      console.error("Error fetching branches:", err);
      setError(err.message || "Failed to fetch branches");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchTeamLeadData = useCallback(
    async (branchList: BranchWithStats[]) => {
      try {
        const teamLeadsMap: Record<string, User[]> = {};
        await Promise.all(
          branchList.map(async (branch) => {
            try {
              const users = await getUsersByBranch(branch.$id);
              teamLeadsMap[branch.$id] = users.filter(
                (u) => u.role === "team_lead",
              );
            } catch {
              teamLeadsMap[branch.$id] = [];
            }
          }),
        );
        setBranchTeamLeads(teamLeadsMap);
      } catch (err: any) {
        console.error("Error fetching team lead data:", err);
      }
    },
    [],
  );

  useEffect(() => {
    if (user) {
      fetchBranches();
    }
  }, [user, fetchBranches]);

  useEffect(() => {
    if (branches.length > 0) {
      fetchTeamLeadData(branches);
    }
  }, [branches, fetchTeamLeadData]);

  const onCreateSubmit = async (data: BranchNameForm) => {
    try {
      setIsSubmitting(true);
      setError(null);
      await createBranch({ name: data.name });
      createForm.reset();
      setShowCreateDialog(false);
      await fetchBranches();
    } catch (err: any) {
      console.error("Error creating branch:", err);
      setError(err.message || "Failed to create branch");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onEditSubmit = async (data: BranchNameForm) => {
    if (!editingBranch) return;
    try {
      setIsSubmitting(true);
      setError(null);
      await updateBranch(editingBranch.$id, { name: data.name });
      editForm.reset();
      setEditingBranch(null);
      await fetchBranches();
    } catch (err: any) {
      console.error("Error updating branch:", err);
      setError(err.message || "Failed to update branch");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (branchId: string) => {
    // Single-click guard: the confirm dialog already opens, but rapid double
    // clicks on the row's Delete button still queue up a second invocation.
    if (deletingBranchId) return;
    const confirmed = await confirm({
      title: "Delete branch?",
      description: "This will permanently delete the branch.",
      confirmText: "Delete",
      cancelText: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingBranchId(branchId);
    try {
      setError(null);
      await deleteBranch(branchId);
      await fetchBranches();
    } catch (err: any) {
      console.error("Error deleting branch:", err);
      setError(err.message || "Failed to delete branch");
    } finally {
      setDeletingBranchId(null);
    }
  };

  const handleToggleStatus = async (branch: Branch) => {
    // Single-click guard: avoid duplicate updateBranch() calls from rapid clicks
    // on the same row's status pill.
    if (togglingBranchId) return;
    setTogglingBranchId(branch.$id);
    try {
      setError(null);
      await updateBranch(branch.$id, { isActive: !branch.isActive });
      await fetchBranches();
    } catch (err: any) {
      console.error("Error toggling branch status:", err);
      setError(err.message || "Failed to update branch status");
    } finally {
      setTogglingBranchId(null);
    }
  };

  const openEditDialog = (branch: Branch) => {
    setEditingBranch(branch);
    editForm.reset({ name: branch.name });
  };

  return (
    <div className="container mx-auto">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Branch Management</CardTitle>
              <CardDescription>
                Create and manage organizational branches
              </CardDescription>
            </div>
            {!isMonitor && (
              <Button
                onClick={() => {
                  setShowCreateDialog(true);
                  setError(null);
                }}
                type="button"
                className="cursor-pointer">
                Create Branch
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            </div>
          ) : branches.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                No branches yet. Create your first branch to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 font-semibold">Name</th>
                    <th className="text-left py-3 px-4 font-semibold">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 font-semibold">
                      Team Leads
                    </th>
                    <th className="text-left py-3 px-4 font-semibold">Leads</th>
                    <th className="text-left py-3 px-4 font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch) => (
                    <tr
                      key={branch.$id}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-3 px-4">{branch.name}</td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => !isMonitor && handleToggleStatus(branch)}
                          disabled={isMonitor || togglingBranchId === branch.$id}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-opacity ${
                            isMonitor || togglingBranchId === branch.$id
                              ? 'cursor-default opacity-60'
                              : 'cursor-pointer hover:opacity-80'
                          } ${
                            branch.isActive
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                          }`}>
                          {togglingBranchId === branch.$id
                            ? "Updating…"
                            : branch.isActive
                              ? "Active"
                              : "Inactive"}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        {branchTeamLeads[branch.$id]?.length > 0 ? (
                          <div className="space-y-1">
                            {branchTeamLeads[branch.$id].map((teamLead) => (
                              <div
                                key={teamLead.$id}
                                className="flex items-center gap-2 text-sm">
                                <span>{teamLead.name}</span>
                                {isAdmin && (
                                  <button
                                    onClick={async () => {
                                      // Single-click guard for the team-lead
                                      // remove (✕) button. Re-running while the
                                      // first removal is in flight is wasteful.
                                      if (removingTeamLeadId) return;
                                      const removalKey = `${branch.$id}::${teamLead.$id}`;
                                      setRemovingTeamLeadId(removalKey);
                                      try {
                                        await removeUserFromBranch(
                                          teamLead.$id,
                                          branch.$id,
                                        );
                                        await fetchBranches();
                                      } catch (err: any) {
                                        setError(
                                          err.message ||
                                            "Failed to remove team lead",
                                        );
                                      } finally {
                                        setRemovingTeamLeadId(null);
                                      }
                                    }}
                                    disabled={
                                      removingTeamLeadId ===
                                      `${branch.$id}::${teamLead.$id}`
                                    }
                                    className="text-red-500 hover:text-red-700 text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                                    title="Remove from this branch">
                                    {removingTeamLeadId ===
                                    `${branch.$id}::${teamLead.$id}`
                                      ? "…"
                                      : "✕"}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">
                            No team leads
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">{branch.leadCount}</td>
                      <td className="py-3 px-4">
                        {!isMonitor && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(branch)}>
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              loading={deletingBranchId === branch.$id}
                              onClick={() => handleDelete(branch.$id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                              Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Branch Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Create New Branch</CardTitle>
              <CardDescription>Add a new organizational branch</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={createForm.handleSubmit(onCreateSubmit)}
                className="space-y-4">
                <div>
                  <Label htmlFor="create-branch-name">Branch Name</Label>
                  <Input
                    id="create-branch-name"
                    {...createForm.register("name")}
                    placeholder="e.g. Downtown Office"
                    className="mt-1"
                  />
                  {createForm.formState.errors.name && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {createForm.formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateDialog(false);
                      createForm.reset();
                      setError(null);
                    }}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto">
                    Create Branch
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Branch Dialog */}
      {editingBranch && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Edit Branch</CardTitle>
              <CardDescription>Modify branch details</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={editForm.handleSubmit(onEditSubmit)}
                className="space-y-4">
                <div>
                  <Label htmlFor="edit-branch-name">Branch Name</Label>
                  <Input
                    id="edit-branch-name"
                    {...editForm.register("name")}
                    placeholder="e.g. Downtown Office"
                    className="mt-1"
                  />
                  {editForm.formState.errors.name && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {editForm.formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingBranch(null);
                      editForm.reset();
                      setError(null);
                    }}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto">
                    Save Changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
