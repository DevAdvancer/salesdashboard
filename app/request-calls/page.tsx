"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLeadsForExportQuery } from "@/lib/queries/leads/use-leads-for-export-query";
import { isVisibleClientLead } from "@/lib/utils/client-history";
import { REQUIRED_DOCUMENTS } from "@/lib/constants/call-request-documents";
import type {
  CallRequest,
  CallRequestChatMessage,
  CallRequestStatus,
  Lead,
  LeadData,
} from "@/lib/types";
import {
  createCallRequestAction,
  listMyCallRequestsAction,
} from "@/app/actions/call-requests";
import { CallRequestChat } from "@/components/call-request-chat";

const STATUS_LABELS: Record<CallRequestStatus, string> = {
  not_called: "Not called",
  pending_documents: "Pending Documents",
  call_done: "Call done",
};

function parseChat(raw: string | null | undefined): CallRequestChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CallRequestChatMessage[]) : [];
  } catch {
    return [];
  }
}

function leadName(lead: Lead): string {
  let data: LeadData = {};
  try {
    data = JSON.parse(lead.data);
  } catch {
    data = {};
  }
  const first = typeof data.firstName === "string" ? data.firstName : "";
  const last = typeof data.lastName === "string" ? data.lastName : "";
  const full = `${first} ${last}`.trim();
  return full || (typeof data.email === "string" ? data.email : "Client");
}

function RequestCallsContent() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [myRequests, setMyRequests] = useState<CallRequest[]>([]);
  const [dialogLead, setDialogLead] = useState<Lead | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openChatId, setOpenChatId] = useState<string | null>(null);

  const clientsQuery = useLeadsForExportQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
    filters: { isClosed: true },
    actionOptions: { skipDepartmentScope: true },
  });

  const clients = useMemo(() => {
    const list = clientsQuery.data?.leads.filter(isVisibleClientLead) ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((lead) => leadName(lead).toLowerCase().includes(query));
  }, [clientsQuery.data, search]);

  const requestByLeadId = useMemo(() => {
    const map = new Map<string, CallRequest>();
    myRequests.forEach((r) => {
      if (!map.has(r.leadId)) map.set(r.leadId, r);
    });
    return map;
  }, [myRequests]);

  const loadMyRequests = useCallback(async () => {
    try {
      const list = await listMyCallRequestsAction();
      setMyRequests(list);
    } catch (e) {
      console.error("Failed to load call requests", e);
    }
  }, []);

  useEffect(() => {
    void loadMyRequests();
  }, [loadMyRequests]);

  const openDialog = (lead: Lead) => {
    setDialogLead(lead);
    setConfirmed({});
    setError(null);
  };

  const allConfirmed = REQUIRED_DOCUMENTS.every((d) => confirmed[d.key]);

  const submit = async () => {
    if (!dialogLead || !allConfirmed) return;
    try {
      setSubmitting(true);
      setError(null);
      await createCallRequestAction({
        leadId: dialogLead.$id,
        clientName: leadName(dialogLead),
        documentsChecklist: REQUIRED_DOCUMENTS.map((d) => ({
          key: d.key,
          label: d.label,
          confirmed: true,
        })),
      });
      setDialogLead(null);
      await loadMyRequests();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold mb-1">Request Calls</h1>
        <p className="text-muted-foreground">
          Ask the Resume team to call one of your clients. All required documents
          must be collected before a request can be sent.
        </p>
      </div>

      {/* My existing requests */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">My Call Requests</h2>
        {myRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have not requested any calls yet.
          </p>
        ) : (
          <div className="space-y-3">
            {myRequests.map((r) => {
              const chat = parseChat(r.chat);
              const open = openChatId === r.$id;
              return (
                <div key={r.$id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{r.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        Status: {STATUS_LABELS[r.status]}
                        {r.assignedToName ? ` · Assigned to ${r.assignedToName}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setOpenChatId(open ? null : r.$id)}
                    >
                      {open ? "Hide chat" : `Chat${chat.length ? ` (${chat.length})` : ""}`}
                    </Button>
                  </div>
                  {open && (
                    <div className="mt-3">
                      <CallRequestChat
                        requestId={r.$id}
                        messages={chat}
                        onPosted={() => void loadMyRequests()}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Client list */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">My Clients</h2>
          <div className="sm:w-72">
            <Label htmlFor="clientSearch">Search</Label>
            <Input
              id="clientSearch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name..."
            />
          </div>
        </div>

        {clientsQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-semibold">Client</th>
                  <th className="text-left p-3 font-semibold">Status</th>
                  <th className="text-left p-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-muted-foreground">
                      No clients found.
                    </td>
                  </tr>
                ) : (
                  clients.slice(0, 50).map((lead) => {
                    const existing = requestByLeadId.get(lead.$id);
                    return (
                      <tr key={lead.$id} className="border-b border-border">
                        <td className="p-3">{leadName(lead)}</td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {existing ? STATUS_LABELS[existing.status] : "—"}
                        </td>
                        <td className="p-3">
                          <Button
                            type="button"
                            size="sm"
                            variant={existing ? "outline" : "default"}
                            onClick={() => openDialog(lead)}
                          >
                            <PhoneCall className="h-4 w-4 mr-1" />
                            {existing ? "Request again" : "Request Call"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Checklist dialog */}
      {dialogLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Request a call</h3>
              <p className="text-sm text-muted-foreground">
                Confirm every document is collected for{" "}
                <span className="font-medium">{leadName(dialogLead)}</span> before
                sending this request to the Resume team.
              </p>
            </div>

            {error && (
              <div className="p-2 border border-red-200 bg-red-50 rounded-md text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              {REQUIRED_DOCUMENTS.map((doc) => (
                <label
                  key={doc.key}
                  className="flex items-center gap-2 rounded-md border border-border p-2 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(confirmed[doc.key])}
                    onChange={(e) =>
                      setConfirmed((prev) => ({ ...prev, [doc.key]: e.target.checked }))
                    }
                  />
                  {doc.label}
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogLead(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={!allConfirmed || submitting}
              >
                {submitting ? "Sending..." : "Send request"}
              </Button>
            </div>
            {!allConfirmed && (
              <p className="text-[11px] text-muted-foreground text-right">
                All documents must be confirmed to send.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function RequestCallsPage() {
  return (
    <ProtectedRoute componentKey="request-calls">
      <RequestCallsContent />
    </ProtectedRoute>
  );
}
