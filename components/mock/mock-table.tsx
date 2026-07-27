"use client";

import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw, AlertCircle } from "lucide-react";
import type { Lead } from "@/lib/types";
import type { MockAttempt } from "./mock-types";

interface MockTableProps {
  paginatedLeads: Lead[];
  mockAttempts: Map<string, MockAttempt>;
  isReadOnly: boolean;
  isAdminUser: boolean;
  isOutlookConnected: boolean;
  isPreparingMock: boolean;
  selectedLead: Lead | null;
  getCooldownStatus: (leadId: string) => {
    canCreate: boolean;
    remainingTime: number;
    count: number;
    isMaxed?: boolean;
  };
  handleCreateMock: (lead: Lead) => void;
  currentPage: number;
  totalPages: number;
  setCurrentPage: (fn: (p: number) => number) => void;
}

export function MockTable({
  paginatedLeads,
  mockAttempts,
  isReadOnly,
  isAdminUser,
  isOutlookConnected,
  isPreparingMock,
  selectedLead,
  getCooldownStatus,
  handleCreateMock,
  currentPage,
  totalPages,
  setCurrentPage,
}: MockTableProps) {
  return (
    <CardContent className="p-0">
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
              const status = getCooldownStatus(lead.$id);
              const attempt = mockAttempts.get(lead.$id);
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
                  <td className="p-4 flex items-center gap-2">
                    {attemptsCount > 0 && (
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          fontWeight: 500,
                          color: "#4ade80",
                          background: "rgba(74,222,128,0.12)",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "999px",
                          border: "1px solid rgba(74,222,128,0.25)",
                        }}>
                        Mock Created
                      </span>
                    )}
                    {!isReadOnly &&
                      (attemptsCount === 0 ? (
                        <Button
                          size="sm"
                          onClick={() => handleCreateMock(lead)}
                          disabled={!isOutlookConnected || isPreparingMock}>
                          {isPreparingMock && selectedLead?.$id === lead.$id
                            ? "Preparing..."
                            : "Create Mock"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2">
                          {(isAdminUser || attemptsCount < 2) &&
                            (status.canCreate ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCreateMock(lead)}
                                disabled={
                                  !isOutlookConnected || isPreparingMock
                                }>
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Retry
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                className="text-orange-500 border-orange-200 bg-orange-50">
                                <Clock className="h-3 w-3 mr-1" />
                                {status.remainingTime}m
                              </Button>
                            ))}
                          {!isAdminUser && attemptsCount >= 2 && (
                            <span className="text-xs font-medium text-red-500 flex items-center">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Max Limit
                            </span>
                          )}
                        </div>
                      ))}
                  </td>
                </tr>
              );
            })}
            {paginatedLeads.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
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
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
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
              setCurrentPage((prev) => Math.min(prev + 1, totalPages))
            }
            disabled={currentPage === totalPages}>
            Next
          </Button>
        </div>
      )}
    </CardContent>
  );
}
