"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { PhoneCall, CheckCircle2, TrendingUp, Clock, AlertCircle, Search } from "lucide-react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listMyCallRequestsAction } from "@/app/actions/call-requests";
import type { CallRequest, CallRequestChatMessage, CallRequestStatus } from "@/lib/types";
import { CallRequestChat } from "@/components/call-request-chat";
import { format } from "date-fns";
import { formatEasternDateTime } from "@/lib/utils/eastern-date";

const STATUS_LABELS: Record<CallRequestStatus, string> = {
  not_called: "Not Called",
  pending_documents: "Pending Documents",
  call_done: "Call Done",
  moved_to_marketing: "Moved to Marketing",
};

const STATUS_ICONS: Record<CallRequestStatus, React.ReactNode> = {
  not_called: <Clock className="h-4 w-4" />,
  pending_documents: <AlertCircle className="h-4 w-4" />,
  call_done: <CheckCircle2 className="h-4 w-4" />,
  moved_to_marketing: <TrendingUp className="h-4 w-4" />,
};

const STATUS_COLORS: Record<CallRequestStatus, string> = {
  not_called: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900",
  pending_documents: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900",
  call_done: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900",
  moved_to_marketing: "text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900",
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

function MyCallRequestsContent() {
  const [myRequests, setMyRequests] = useState<CallRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CallRequestStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const loadMyRequests = useCallback(async (search: string) => {
    try {
      setLoading(true);
      const list = await listMyCallRequestsAction(search);
      setMyRequests(list);
    } catch (e) {
      console.error("Failed to load call requests", e);
      setError("Failed to load call requests. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMyRequests(appliedSearch);
  }, [loadMyRequests, appliedSearch]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return myRequests;
    return myRequests.filter((r) => r.status === statusFilter);
  }, [myRequests, statusFilter]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <PhoneCall className="h-8 w-8 text-primary" />
            My Call Requests
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track the status of call requests you&apos;ve raised for the Resume team.
          </p>
        </div>
      </div>

      <Card className="p-4 bg-card/60 backdrop-blur border border-border shadow-sm flex flex-col md:flex-row items-center gap-4 justify-between">
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 w-full md:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by client name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setAppliedSearch(searchQuery);
                }
              }}
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-sm font-semibold text-muted-foreground whitespace-nowrap">Filter Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CallRequestStatus | "all")}
              className="rounded-md border border-input bg-background pl-3 pr-8 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Statuses</option>
              <option value="not_called">Not Called</option>
              <option value="pending_documents">Pending Documents</option>
              <option value="call_done">Call Done</option>
              <option value="moved_to_marketing">Moved to Marketing</option>
            </select>
          </div>
        </div>
        <div className="text-sm font-medium text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md border border-border/50 whitespace-nowrap">
          Total: {filteredRequests.length}
        </div>
      </Card>

      {error && (
        <div className="p-4 bg-destructive/15 text-destructive rounded-md text-sm font-medium">
          {error}
        </div>
      )}

      <Card className="overflow-hidden border border-border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Requested At</th>
                <th className="px-4 py-3 text-right">Actions / Chat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <div className="animate-pulse flex space-x-4 justify-center">
                      <div className="h-4 w-32 bg-muted rounded"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    No call requests found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((r) => {
                  const chat = parseChat(r.chat);
                  const open = openChatId === r.$id;
                  const isMovedToMarketing = r.status === "moved_to_marketing";
                  
                  return (
                    <tr key={r.$id} className="group hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-4 font-medium align-top">
                        <div className="text-foreground">{r.clientName}</div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border ${STATUS_COLORS[r.status] || "bg-secondary text-secondary-foreground"}`}>
                          {STATUS_ICONS[r.status]}
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top text-muted-foreground">
                        {r.assignedToName || "—"}
                      </td>
                      <td className="px-4 py-4 align-top text-muted-foreground">
                        {formatEasternDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-col items-end gap-2">
                          {isMovedToMarketing ? (
                            <div className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-md border flex items-center gap-1.5 cursor-not-allowed" title="Chat is locked because this profile has been moved to Marketing">
                              <TrendingUp className="h-3.5 w-3.5" />
                              Chat Locked
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant={open ? "default" : "outline"}
                              size="sm"
                              className={open ? "shadow-sm" : "bg-background"}
                              onClick={() => setOpenChatId(open ? null : r.$id)}
                            >
                              {open ? "Hide Chat" : `Chat${chat.length ? ` (${chat.length})` : ""}`}
                            </Button>
                          )}
                        </div>
                        {open && !isMovedToMarketing && (
                          <div className="mt-4 min-w-[300px] max-w-md float-right clear-both">
                            <CallRequestChat
                              requestId={r.$id}
                              messages={chat}
                              onPosted={() => void loadMyRequests(appliedSearch)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function MyCallRequestsPage() {
  return (
    <ProtectedRoute componentKey="my-call-requests">
      <MyCallRequestsContent />
    </ProtectedRoute>
  );
}
