"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { RefreshCw } from "lucide-react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  CALL_REQUEST_STATUSES,
  type CallRequest,
  type CallRequestChatMessage,
  type CallRequestChecklistItem,
  type CallRequestStatus,
} from "@/lib/types";
import {
  assignCallRequestAction,
  getCallRequestOptionsAction,
  listCallRequestsAction,
  updateCallRequestStatusAction,
  type CallRequestUserOption,
} from "@/app/actions/call-requests";
import { CallRequestChat } from "@/components/call-request-chat";

const STATUS_LABELS: Record<CallRequestStatus, string> = {
  not_called: "Not called",
  pending_documents: "Pending Documents",
  call_done: "Call done",
};

const STATUS_BADGE: Record<CallRequestStatus, string> = {
  not_called: "bg-secondary text-secondary-foreground",
  pending_documents: "bg-amber-100 text-amber-800",
  call_done: "bg-emerald-100 text-emerald-800",
};

function parse<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function CallsContent() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CallRequest[]>([]);
  const [options, setOptions] = useState<CallRequestUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openChatId, setOpenChatId] = useState<string | null>(null);

  const canAssign = useMemo(() => {
    if (!user) return false;
    return (
      user.role === "team_lead" ||
      user.role === "admin" ||
      user.role === "developer" ||
      user.role === "monitor" ||
      user.role === "operations"
    );
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, opts] = await Promise.all([
        listCallRequestsAction(),
        getCallRequestOptionsAction(),
      ]);
      setRequests(list);
      setOptions(opts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load call requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (requestId: string, status: CallRequestStatus) => {
    try {
      setBusyId(requestId);
      await updateCallRequestStatusAction({ requestId, status });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  };

  const assign = async (requestId: string, assignedToId: string) => {
    if (!assignedToId) return;
    try {
      setBusyId(requestId);
      await assignCallRequestAction({ requestId, assignedToId });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to assign.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Calls</h1>
          <p className="text-muted-foreground">
            Incoming call requests from the Sales team.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1" />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="p-3 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-semibold">Client</th>
                  <th className="text-left p-3 font-semibold">Requested By</th>
                  <th className="text-left p-3 font-semibold">Status</th>
                  <th className="text-left p-3 font-semibold">Assigned To</th>
                  <th className="text-left p-3 font-semibold">Chat</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      No call requests yet.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => {
                    const chat = parse<CallRequestChatMessage>(r.chat);
                    const docs = parse<CallRequestChecklistItem>(r.documentsChecklist);
                    const open = openChatId === r.$id;
                    const rowBusy = busyId === r.$id;
                    return (
                      <Fragment key={r.$id}>
                        <tr className="border-b border-border align-top">
                          <td className="p-3">
                            <p className="font-medium">{r.clientName}</p>
                            {docs.length > 0 && (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                {docs.length} document{docs.length !== 1 ? "s" : ""}{" "}
                                confirmed
                              </p>
                            )}
                          </td>
                          <td className="p-3 text-sm">{r.requestedByName}</td>
                          <td className="p-3">
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                              value={r.status}
                              disabled={rowBusy}
                              onChange={(e) =>
                                changeStatus(r.$id, e.target.value as CallRequestStatus)
                              }
                            >
                              {CALL_REQUEST_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                            <span
                              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${STATUS_BADGE[r.status]}`}
                            >
                              {STATUS_LABELS[r.status]}
                            </span>
                          </td>
                          <td className="p-3">
                            {canAssign ? (
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                value={r.assignedToId ?? ""}
                                disabled={rowBusy}
                                onChange={(e) => assign(r.$id, e.target.value)}
                              >
                                <option value="">Unassigned</option>
                                {options.map((o) => (
                                  <option key={o.$id} value={o.$id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {r.assignedToName ?? "Unassigned"}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setOpenChatId(open ? null : r.$id)}
                            >
                              {open ? "Hide" : `Chat${chat.length ? ` (${chat.length})` : ""}`}
                            </Button>
                          </td>
                        </tr>
                        {open && (
                          <tr key={`${r.$id}-chat`} className="border-b border-border">
                            <td colSpan={5} className="p-3 bg-muted/30">
                              <CallRequestChat
                                requestId={r.$id}
                                messages={chat}
                                onPosted={() => void load()}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CallsPage() {
  return (
    <ProtectedRoute componentKey="call-requests">
      <CallsContent />
    </ProtectedRoute>
  );
}
