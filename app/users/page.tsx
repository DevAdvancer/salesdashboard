'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { createManagerAction, createTeamLeadAction, createAgentAction } from '@/app/actions/user';
import {
  getUsersByBranches,
  getAgentsByManager,
} from '@/lib/services/user-service';
import { listBranches } from '@/lib/services/branch-service';
import { User, Branch } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProtectedRoute } from '@/components/protected-route';

export default function UserManagementPage() {
  return (
    <ProtectedRoute componentKey="user-management">
      <UserManagementContent />
    </ProtectedRoute>
  );
}

function UserManagementContent() {
  const router = useRouter();
  const { user, isManager, isAdmin, isTeamLead } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [branchMap, setBranchMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Determine which role the current user can create
  const canCreateManager = isAdmin;
  const canCreateTeamLead = isManager && user?.role === 'manager';
  const canCreateAgent = isTeamLead;
  const canCreate = canCreateManager || canCreateTeamLead || canCreateAgent;

  // The branches available for assignment (subset of current user's branchIds)
  const availableBranches = allBranches.filter(
    (b) => b.isActive && (isAdmin || (user?.branchIds ?? []).includes(b.$id))
  );

  useEffect(() => {
    if (user) {
      fetchUsers();
      fetchBranches();
    }
  }, [user]);

  const fetchUsers = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      if (isAdmin) {
        // Admin sees all users regardless of branches
        const { databases } = await import('@/lib/appwrite');
        const response = await databases.listDocuments(
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
          process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!
        );
        const allUsers = response.documents.map((doc: any) => ({
          $id: doc.$id,
          name: doc.name,
          email: doc.email,
          role: doc.role,
          managerId: doc.managerId || null,
          teamLeadId: doc.teamLeadId || null,
          branchIds: doc.branchIds || [],
          branchId: doc.branchId || null,
          $createdAt: doc.$createdAt,
          $updatedAt: doc.$updatedAt,
        }));
        setUsers(allUsers);
      } else if (user.role === 'manager' && user.branchIds.length > 0) {
        const usersList = await getUsersByBranches(user.branchIds);
        setUsers(usersList);
      } else if (user.role === 'team_lead' && user.branchIds.length > 0) {
        const usersList = await getUsersByBranches(user.branchIds);
        // Team lead sees only agents with overlapping branches
        setUsers(usersList.filter((u) => u.role === 'agent'));
      } else {
        const agentsList = await getAgentsByManager(user.$id);
        setUsers(agentsList);
      }
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError(err.message || 'Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const branchesList = await listBranches();
      setAllBranches(branchesList);
      const map = new Map<string, string>();
      branchesList.forEach((b) => map.set(b.$id, b.name));
      setBranchMap(map);
    } catch (err: any) {
      console.error('Error fetching branches:', err);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setSelectedBranchIds([]);
    setFormErrors({});
    setError(null);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!formName.trim()) errs.name = 'Name is required';
    if (!formEmail.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) errs.email = 'Invalid email address';
    if (!formPassword) errs.password = 'Password is required';
    else if (formPassword.length < 8) errs.password = 'Password must be at least 8 characters';
    if (selectedBranchIds.length === 0) errs.branches = 'At least one branch must be selected';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleEdit = (userToEdit: User) => {
    setEditingUser(userToEdit);
    setSelectedBranchIds(userToEdit.branchIds || []);
    setError(null);
  };

  const handleUpdateBranches = async () => {
    if (!editingUser || !user) return;

    try {
      setIsUpdating(true);
      setError(null);

      const { databases } = await import('@/lib/appwrite');
      await databases.updateDocument(
        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
        process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
        editingUser.$id,
        { branchIds: selectedBranchIds }
      );

      setEditingUser(null);
      setSelectedBranchIds([]);
      await fetchUsers();
    } catch (err: any) {
      console.error('Error updating user branches:', err);
      setError(err.message || 'Failed to update user branches');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCreate = async () => {
    if (!user || !validateForm()) return;

    try {
      setIsCreating(true);
      setError(null);

      if (canCreateManager) {
        // Admin creates a Manager
        await createManagerAction({
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          branchIds: selectedBranchIds,
          currentUserId: user.$id,
        });
      } else if (canCreateTeamLead) {
        // Manager creates a Team Lead
        await createTeamLeadAction({
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          managerId: user.$id,
          branchIds: selectedBranchIds,
          currentUserId: user.$id,
        });
      } else if (canCreateAgent) {
        // Team Lead creates an Agent
        await createAgentAction({
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          teamLeadId: user.$id,
          branchIds: selectedBranchIds,
          currentUserId: user.$id,
        });
      }

      resetForm();
      setShowCreateDialog(false);
      await fetchUsers();
    } catch (err: any) {
      console.error('Error creating user:', err);
      setError(err.message || 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  const createButtonLabel = canCreateManager ? 'Create Manager' : canCreateTeamLead ? 'Create Team Lead' : 'Create Agent';
  const dialogTitle = canCreateManager ? 'Create New Manager' : canCreateTeamLead ? 'Create New Team Lead' : 'Create New Agent';
  const dialogDescription = canCreateManager
    ? 'Add a new manager and assign them to branches'
    : canCreateTeamLead
      ? 'Add a new team lead and assign them to your branches'
      : 'Add a new agent and assign them to your branches';

  const formatRole = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'manager':
        return 'Manager';
      case 'team_lead':
        return 'Team Lead';
      case 'agent':
        return 'Agent';
      default:
        return role;
    }
  };

  const formatBranches = (branchIds: string[]) => {
    if (!branchIds || branchIds.length === 0) return '—';
    return branchIds.map((id) => branchMap.get(id) || id).join(', ');
  };

  return (
    <div className="container mx-auto">
      <div className="mb-4">
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard')}
          className="mb-4"
        >
          ← Back to Dashboard
        </Button>
      </div>
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
                className="cursor-pointer"
              >
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
                No users found. {canCreate ? `Create your first ${canCreateManager ? 'manager' : canCreateTeamLead ? 'team lead' : 'agent'} to get started.` : ''}
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
                    <th className="text-left py-3 px-4 font-semibold">Branches</th>
                    <th className="text-left py-3 px-4 font-semibold">Created</th>
                    {isAdmin && <th className="text-left py-3 px-4 font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.$id}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="py-3 px-4">{u.name}</td>
                      <td className="py-3 px-4">{u.email}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                          {formatRole(u.role)}
                        </span>
                      </td>
                      <td className="py-3 px-4">{formatBranches(u.branchIds)}</td>
                      <td className="py-3 px-4">
                        {u.$createdAt ? new Date(u.$createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          {(u.role === 'manager' || u.role === 'team_lead' || u.role === 'agent') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(u)}
                            >
                              Edit Branches
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
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
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{formErrors.name}</p>
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
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{formErrors.email}</p>
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
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{formErrors.password}</p>
                  )}
                </div>

                {/* Branch multi-select */}
                <div>
                  <Label>Branches</Label>
                  {availableBranches.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      No branches available. You need at least one assigned branch.
                    </p>
                  ) : (
                    <div className="mt-1 space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                      {availableBranches.map((branch) => (
                        <label
                          key={branch.$id}
                          className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded"
                        >
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
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{formErrors.branches}</p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateDialog(false);
                      resetForm();
                    }}
                    disabled={isCreating}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreate}
                    disabled={isCreating}
                    className="w-full sm:w-auto"
                  >
                    {isCreating ? 'Creating...' : createButtonLabel}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit User Branches Dialog */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Edit User Branches</CardTitle>
              <CardDescription>
                Update branch assignments for {editingUser.name} ({formatRole(editingUser.role)})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
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
                          className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded"
                        >
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
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleUpdateBranches}
                    disabled={isUpdating}
                    className="w-full sm:w-auto"
                  >
                    {isUpdating ? 'Updating...' : 'Update Branches'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
