"use client";

import { ProtectedRoute } from "@/components/protected-route";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUserManagement } from "@/lib/hooks/local/use-user-management";
import { UserTable } from "@/components/users/user-table";
import { CreateUserDialog } from "@/components/users/create-user-dialog";
import { EditUserDialog } from "@/components/users/edit-user-dialog";

export default function UserManagementPage() {
  return (
    <ProtectedRoute componentKey="user-management">
      <UserManagementContent />
    </ProtectedRoute>
  );
}

function UserManagementContent() {
  const {
    user, isAdmin, isDeveloper, isTeamLead, isMonitor, isOperations, activeDashboard,
    currentUsersPage, setCurrentUsersPage, USERS_PAGE_SIZE, usersTotal,
    search, setSearch, branchMap, isLoading, isCreating,
    showCreateDialog, setShowCreateDialog, editingUser, setEditingUser,
    isUpdating, deletingUserId, activeStatusUserId, error, setError,
    ConfirmDialog, formName, setFormName, formEmail, setFormEmail,
    formPassword, setFormPassword, selectedBranchIds, setSelectedBranchIds,
    selectedTeamLeadId, setSelectedTeamLeadId, createDepartment, setCreateDepartment,
    departmentFilter, setDepartmentFilter, editRole, setEditRole,
    editEmail, setEditEmail, editDepartment, setEditDepartment,
    formErrors, availableTeamLeads, createRole, setCreateRole,
    canCreateAdmin, canCreateDeveloper, canCreateTeamLead, canCreateAgent,
    canCreateLeadGeneration, canCreateMonitor, canCreateOperations, canCreate,
    availableBranches, toggleBranch, handleEdit, handleUpdateUser,
    handleDeleteUser, handleSetAgentActive, handleCreate, resetForm,
    filteredUsers, teamLeadOptions
  } = useUserManagement();

  const dialogTitle = "Create User";
  const dialogDescription = isAdmin
    ? "Add a new user and assign them to branches"
    : "Add a new team member and assign them to your branches";
  const createButtonLabel = "Create User";

  return (
    <div className="container mx-auto">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                {departmentFilter === "all"
                  ? "Manage your team members"
                  : departmentFilter === "resume"
                    ? "Resume team members"
                    : "Sales team members"}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </CardHeader>
        <CardContent>
          {error && !showCreateDialog && !editingUser && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <UserTable
            filteredUsers={filteredUsers}
            isLoading={isLoading}
            canCreate={canCreate}
            activeDashboard={activeDashboard}
            isAdmin={isAdmin}
            isDeveloper={isDeveloper}
            isTeamLead={isTeamLead}
            isMonitor={isMonitor}
            isOperations={isOperations}
            user={user}
            branchMap={branchMap}
            search={search}
            setSearch={setSearch}
            handleEdit={handleEdit}
            handleSetAgentActive={handleSetAgentActive}
            handleDeleteUser={handleDeleteUser}
            activeStatusUserId={activeStatusUserId}
            deletingUserId={deletingUserId}
            currentUsersPage={currentUsersPage}
            setCurrentUsersPage={setCurrentUsersPage}
            usersTotal={usersTotal}
            USERS_PAGE_SIZE={USERS_PAGE_SIZE}
          />
        </CardContent>
      </Card>

      <CreateUserDialog
        showCreateDialog={showCreateDialog}
        setShowCreateDialog={setShowCreateDialog}
        error={error}
        formName={formName}
        setFormName={setFormName}
        formEmail={formEmail}
        setFormEmail={setFormEmail}
        formPassword={formPassword}
        setFormPassword={setFormPassword}
        formErrors={formErrors}
        createRole={createRole}
        setCreateRole={setCreateRole}
        canCreateAdmin={canCreateAdmin}
        canCreateDeveloper={canCreateDeveloper}
        canCreateTeamLead={canCreateTeamLead}
        canCreateAgent={canCreateAgent}
        canCreateLeadGeneration={canCreateLeadGeneration}
        canCreateMonitor={canCreateMonitor}
        canCreateOperations={canCreateOperations}
        isAdmin={isAdmin}
        isDeveloper={isDeveloper}
        isTeamLead={isTeamLead}
        activeDashboard={activeDashboard}
        createDepartment={createDepartment}
        teamLeadOptions={teamLeadOptions}
        selectedTeamLeadId={selectedTeamLeadId}
        setSelectedTeamLeadId={setSelectedTeamLeadId}
        availableBranches={availableBranches}
        selectedBranchIds={selectedBranchIds}
        toggleBranch={toggleBranch}
        isCreating={isCreating}
        handleCreate={handleCreate}
        resetForm={resetForm}
        dialogTitle={dialogTitle}
        dialogDescription={dialogDescription}
        createButtonLabel={createButtonLabel}
      />

      <EditUserDialog
        editingUser={editingUser}
        setEditingUser={setEditingUser}
        error={error}
        setError={setError}
        isAdmin={isAdmin}
        isDeveloper={isDeveloper}
        editRole={editRole}
        setEditRole={setEditRole}
        editEmail={editEmail}
        setEditEmail={setEditEmail}
        editDepartment={editDepartment}
        setEditDepartment={setEditDepartment}
        teamLeadOptions={teamLeadOptions}
        selectedTeamLeadId={selectedTeamLeadId}
        setSelectedTeamLeadId={setSelectedTeamLeadId}
        availableBranches={availableBranches}
        selectedBranchIds={selectedBranchIds}
        setSelectedBranchIds={setSelectedBranchIds}
        toggleBranch={toggleBranch}
        isUpdating={isUpdating}
        handleUpdateUser={handleUpdateUser}
      />

      <ConfirmDialog />
    </div>
  );
}
