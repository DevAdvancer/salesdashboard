'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getBranchStats,
} from '@/lib/services/branch-service';
import {
  getUnassignedManagers,
  getUsersByBranch,
  assignManagerToBranch,
} from '@/lib/services/user-service';
import { Branch, User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ProtectedRoute } from '@/components/protected-route';

const branchNameSchema = z.object({
  name: z.string().min(1, 'Branch name is required').max(128, 'Branch name is too long'),
});

type BranchNameForm = z.infer<typeof branchNameSchema>;

interface BranchWithStats extends Branch {
  managerCount: number;
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
  const router = useRouter();
  const { user } = useAuth();
  const [branches, setBranches] = useState<BranchWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manager assignment state
  const [unassignedManagers, setUnassignedManagers] = useState<User[]>([]);
  const [branchManagers, setBranchManagers] = useState<Record<string, User[]>>({});
  const [assigningBranchId, setAssigningBranchId] = useState<string | null>(null);

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
            return { ...branch, managerCount: stats.managerCount, leadCount: stats.leadCount };
          } catch {
            return { ...branch, managerCount: 0, leadCount: 0 };
          }
        })
      );

      setBranches(branchesWithStats);
    } catch (err: any) {
      console.error('Error fetching branches:', err);
      setError(err.message || 'Failed to fetch branches');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchManagerData = useCallback(async (branchList: BranchWithStats[]) => {
    try {
      const unassigned = await getUnassignedManagers();
      setUnassignedManagers(unassigned);

      const managersMap: Record<string, User[]> = {};
      await Promise.all(
        branchList.map(async (branch) => {
          try {
            const users = await getUsersByBranch(branch.$id);
            managersMap[branch.$id] = users.filter((u) => u.role === 'manager');
          } catch {
            managersMap[branch.$id] = [];
          }
        })
      );
      setBranchManagers(managersMap);
    } catch (err: any) {
      console.error('Error fetching manager data:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchBranches();
    }
  }, [user, fetchBranches]);

  useEffect(() => {
    if (branches.length > 0) {
      fetchManagerData(branches);
    }
  }, [branches, fetchManagerData]);

  const onCreateSubmit = async (data: BranchNameForm) => {
    try {
      setIsSubmitting(true);
      setError(null);
      await createBranch({ name: data.name });
      createForm.reset();
      setShowCreateDialog(false);
      await fetchBranches();
    } catch (err: any) {
      console.error('Error creating branch:', err);
      setError(err.message || 'Failed to create branch');
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
      console.error('Error updating branch:', err);
      setError(err.message || 'Failed to update branch');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (branchId: string) => {
    if (!confirm('Are you sure you want to delete this branch?')) return;
    try {
      setError(null);
      await deleteBranch(branchId);
      await fetchBranches();
    } catch (err: any) {
      console.error('Error deleting branch:', err);
      setError(err.message || 'Failed to delete branch');
    }
  };

  const handleToggleStatus = async (branch: Branch) => {
    try {
      setError(null);
      await updateBranch(branch.$id, { isActive: !branch.isActive });
      await fetchBranches();
    } catch (err: any) {
      console.error('Error toggling branch status:', err);
      setError(err.message || 'Failed to update branch status');
    }
  };

  const handleAssignManager = async (branchId: string, managerId: string) => {
    if (!managerId) return;
    try {
      setAssigningBranchId(branchId);
      setError(null);
      await assignManagerToBranch(managerId, branchId);
      await fetchBranches();
    } catch (err: any) {
      console.error('Error assigning manager:', err);
      setError(err.message || 'Failed to assign manager');
    } finally {
      setAssigningBranchId(null);
    }
  };

  const openEditDialog = (branch: Branch) => {
    setEditingBranch(branch);
    editForm.reset({ name: branch.name });
  };

  const getAssignableManagers = (branchId: string): User[] => {
    const managersFromOtherBranches: User[] = [];
    for (const [bId, managers] of Object.entries(branchManagers)) {
      if (bId !== branchId) {
        managersFromOtherBranches.push(...managers);
      }
    }
    return [...unassignedManagers, ...managersFromOtherBranches];
  };

  return (
    <div className="container mx-auto">
      <div className="mb-4">
        <Button variant="outline" onClick={() => router.push('/dashboard')} className="mb-4">
          ← Back to Dashboard
        </Button>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Branch Management</CardTitle>
              <CardDescription>Create and manage organizational branches</CardDescription>
            </div>
            <Button
              onClick={() => {
                setShowCreateDialog(true);
                setError(null);
              }}
              type="button"
              className="cursor-pointer"
            >
              Create Branch
            </Button>
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
                    <th className="text-left py-3 px-4 font-semibold">Status</th>
                    <th className="text-left py-3 px-4 font-semibold">Managers</th>
                    <th className="text-left py-3 px-4 font-semibold">Leads</th>
                    <th className="text-left py-3 px-4 font-semibold">Assign Manager</th>
                    <th className="text-left py-3 px-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch) => {
                    const assignableManagers = getAssignableManagers(branch.$id);
                    return (
                      <tr
                        key={branch.$id}
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <td className="py-3 px-4">{branch.name}</td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleToggleStatus(branch)}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${
                              branch.isActive
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {branch.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="py-3 px-4">{branch.managerCount}</td>
                        <td className="py-3 px-4">{branch.leadCount}</td>
                        <td className="py-3 px-4">
                          <select
                            className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-800 disabled:opacity-50"
                            defaultValue=""
                            disabled={assigningBranchId === branch.$id || assignableManagers.length === 0}
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAssignManager(branch.$id, e.target.value);
                                e.target.value = '';
                              }
                            }}
                          >
                            <option value="">
                              {assignableManagers.length === 0
                                ? 'No managers available'
                                : assigningBranchId === branch.$id
                                  ? 'Assigning...'
                                  : 'Select manager'}
                            </option>
                            {assignableManagers.map((manager) => (
                              <option key={manager.$id} value={manager.$id}>
                                {manager.name} ({manager.email}){manager.branchId ? ' - reassign' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(branch)}>
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(branch.$id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="create-branch-name">Branch Name</Label>
                  <Input
                    id="create-branch-name"
                    {...createForm.register('name')}
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
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
                    {isSubmitting ? 'Creating...' : 'Create Branch'}
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
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="edit-branch-name">Branch Name</Label>
                  <Input
                    id="edit-branch-name"
                    {...editForm.register('name')}
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
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
                    {isSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
