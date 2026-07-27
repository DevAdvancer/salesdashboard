"use client";

import type { Lead } from "@/lib/types";
import { Button } from "@/components/ui/button";
import type { AssessmentAttempt } from "./types";

interface LeadsTableProps {
  paginatedLeads: Lead[];
  assessmentAttempts: Map<string, AssessmentAttempt>;
  isReadOnly: boolean;
  isOutlookConnected: boolean;
  isPreparingAssessment: boolean;
  selectedLeadId: string | null;
  onCreateAssessment: (lead: Lead) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function LeadsTable({
  paginatedLeads,
  assessmentAttempts,
  isReadOnly,
  isOutlookConnected,
  isPreparingAssessment,
  selectedLeadId,
  onCreateAssessment,
  currentPage,
  totalPages,
  onPageChange,
}: LeadsTableProps) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="border-b bg-muted/50">
            <tr className="text-left">
              <th className="p-4 font-semibold">Name</th>
              <th className="p-4 font-semibold">Phone</th>
              <th className="p-4 font-semibold">Email</th>
              <th className="p-4 font-semibold">Source</th>
              <th className="p-4 font-semibold">Company</th>
              <th className="p-4 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedLeads.map((lead) => {
              const leadData = JSON.parse(lead.data);
              const attempt = assessmentAttempts.get(lead.$id);
              const attemptsCount = attempt?.attemptCount || 0;

              return (
                <tr
                  key={lead.$id}
                  className="border-b hover:bg-muted/50 transition-colors">
                  <td className="p-4">
                    {leadData.firstName} {leadData.lastName}
                    {leadData.legalName && (
                      <div className="text-xs text-muted-foreground">
                        ({leadData.legalName})
                      </div>
                    )}
                  </td>
                  <td className="p-4">{leadData.phone || "N/A"}</td>
                  <td className="p-4">{leadData.email || "N/A"}</td>
                  <td className="p-4">
                    {leadData.sourceName || leadData.source || "-"}
                  </td>
                  <td className="p-4">{leadData.company || "N/A"}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      {attemptsCount > 0 && (
                        <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#4ade80', background: 'rgba(74,222,128,0.12)', padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid rgba(74,222,128,0.25)' }}>
                          {attemptsCount} Sent
                        </span>
                      )}
                      <Button
                        size="sm"
                        onClick={() => onCreateAssessment(lead)}
                        disabled={isReadOnly || !isOutlookConnected || isPreparingAssessment}>
                        {isPreparingAssessment && selectedLeadId === lead.$id
                          ? "Preparing..."
                          : "Create Assessment"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {paginatedLeads.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-muted-foreground">
                  No leads found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end space-x-2 p-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
            disabled={currentPage === 1}>
            Previous
          </Button>
          <div className="text-sm font-medium">
            Page {currentPage} of {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onPageChange(Math.min(currentPage + 1, totalPages))
            }
            disabled={currentPage === totalPages}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
