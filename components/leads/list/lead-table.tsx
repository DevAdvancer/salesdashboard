"use client";

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Lead, User, LeadListFilters } from "@/lib/types";

function parseLeadData(lead: Lead) {
  try {
    return JSON.parse(lead.data);
  } catch {
    return {};
  }
}

const AssignedAgentName = memo(function AssignedAgentName({
  agentId,
  assignedUsers,
}: {
  agentId: string;
  assignedUsers: Map<string, User>;
}) {
  const agent = assignedUsers.get(agentId);
  return <span>{agent?.name || "Unknown"}</span>;
});

const OwnerName = memo(function OwnerName({
  ownerId,
  owners,
}: {
  ownerId: string;
  owners: Map<string, User>;
}) {
  const owner = owners.get(ownerId);
  return <span>{owner?.name || "Unknown"}</span>;
});

/**
 * Memoized table row. Re-renders only when its own lead, the resolved
 * assigned/owner user, or the visible status string changes. Keeps the
 * per-keystroke filter cost bounded to the row actually being edited.
 */
export const LeadRow = memo(
  function LeadRow({
    lead,
    showAssigned,
    assignedUsers,
    owners,
    onView,
  }: {
    lead: Lead;
    showAssigned: boolean;
    assignedUsers: Map<string, User>;
    owners: Map<string, User>;
    onView: (leadId: string) => void;
  }) {
    const leadData = parseLeadData(lead);
    const firstName =
      typeof leadData.firstName === "string" ? leadData.firstName : "";
    const lastName =
      typeof leadData.lastName === "string" ? leadData.lastName : "";
    const email = typeof leadData.email === "string" ? leadData.email : "";
    const sourceName =
      typeof leadData.sourceName === "string" ? leadData.sourceName : "";
    const source = typeof leadData.source === "string" ? leadData.source : "";

    return (
      <tr className="border-b hover:bg-accent/50 transition-colors">
        <td className="p-3 md:p-4">
          {firstName} {lastName}
        </td>
        <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
          {email}
        </td>
        <td className="p-3 md:p-4">
          <span className="inline-block px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-primary/10 text-primary">
            {lead.status}
          </span>
        </td>
        <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
          {sourceName || source || "-"}
        </td>
        {showAssigned && (
          <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
            {lead.assignedToId ? (
              <AssignedAgentName
                agentId={lead.assignedToId}
                assignedUsers={assignedUsers}
              />
            ) : (
              "Unassigned"
            )}
          </td>
        )}
        {showAssigned && (
          <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
            <OwnerName ownerId={lead.ownerId} owners={owners} />
          </td>
        )}
        <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
          {lead.$createdAt
            ? new Date(lead.$createdAt).toLocaleDateString()
            : "N/A"}
        </td>
        <td className="p-3 md:p-4">
          <Button
            id="tour-lead-view-btn"
            size="sm"
            variant="outline"
            onClick={() => onView(lead.$id)}>
            View
          </Button>
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.lead.$id === next.lead.$id &&
    prev.lead.status === next.lead.status &&
    prev.lead.$createdAt === next.lead.$createdAt &&
    prev.lead.data === next.lead.data &&
    prev.lead.ownerId === next.lead.ownerId &&
    prev.lead.assignedToId === next.lead.assignedToId &&
    prev.showAssigned === next.showAssigned &&
    prev.assignedUsers === next.assignedUsers &&
    prev.owners === next.owners &&
    prev.onView === next.onView,
);

interface LeadTableProps {
  leads: Lead[];
  leadRows: React.ReactNode;
  showAssigned: boolean;
  totalPages: number;
  currentPage: number;
  setCurrentPage: (fn: (p: number) => number) => void;
  filters: LeadListFilters;
  isReadOnlyAdminView: boolean;
}

export function LeadTable({
  leads,
  leadRows,
  showAssigned,
  totalPages,
  currentPage,
  setCurrentPage,
  filters,
  isReadOnlyAdminView,
}: LeadTableProps) {
  if (leads.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">
            No leads found.{" "}
            {Object.keys(filters).length > 0
              ? "Try adjusting your filters."
              : isReadOnlyAdminView
                ? "No active leads are available."
                : "Create your first lead to get started."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="border-b">
                <tr className="text-left">
                  <th className="p-3 md:p-4 font-semibold">Name</th>
                  <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">
                    Email
                  </th>
                  <th className="p-3 md:p-4 font-semibold">Status</th>
                  <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">
                    Source
                  </th>
                  {showAssigned && (
                    <th className="p-3 md:p-4 font-semibold hidden md:table-cell">
                      Assigned To
                    </th>
                  )}
                  {showAssigned && (
                    <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">
                      Owner
                    </th>
                  )}
                  <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">
                    Created
                  </th>
                  <th className="p-3 md:p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leadRows}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentPage((p) => Math.min(totalPages, p + 1))
            }
            disabled={currentPage === totalPages}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
