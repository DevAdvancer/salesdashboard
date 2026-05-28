"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  checkLinkedinDuplicateAction,
  createLinkedinRequestAction,
  getLinkedinConnectionHistoryAction,
  listMyLinkedinAccountsAction,
  listMyLinkedinRequestsForAccountAction,
  markLinkedinRequestAcceptedAction,
  withdrawLinkedinRequestAction,
} from "@/app/actions/linkedin";
import type { LinkedinAccount, LinkedinRequest } from "@/lib/types";

const LINKEDIN_ACCEPT_WINDOW_DAYS = 15;

function todayDateInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again";
}

function RequiredMark() {
  return <span className="text-red-500">*</span>;
}

function daysSinceDateInputValue(dateValue: string) {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 0;

  const now = new Date();
  const startUtc = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
  return Math.max(diff, 0);
}

function LinkedinRequestsContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [accounts, setAccounts] = useState<LinkedinAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [dateSent, setDateSent] = useState(todayDateInputValue());
  const [targetUrl, setTargetUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState<boolean | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTargetUrl, setHistoryTargetUrl] = useState("");
  const [historyData, setHistoryData] = useState<Awaited<
    ReturnType<typeof getLinkedinConnectionHistoryAction>
  > | null>(null);
  const [adding, setAdding] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [requests, setRequests] = useState<LinkedinRequest[]>([]);
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "accepted" | "withdrawn">("all");
  const [filterUrl, setFilterUrl] = useState<string>("");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.$id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const today = todayDateInputValue();
  const todayIso = useMemo(() => new Date(today).toISOString(), [today]);
  const dailyLimit =
    typeof selectedAccount?.connectionLimit === "number"
      ? selectedAccount.connectionLimit
      : null;
  const usedToday = useMemo(() => {
    return requests.filter((r) => {
      const isActive = r.isActive !== false;
      return isActive && r.status !== "withdrawn" && r.dateSent === todayIso;
    }).length;
  }, [requests, todayIso]);
  const remainingToday =
    dailyLimit === null ? null : Math.max(dailyLimit - usedToday, 0);

  const loadAccounts = useCallback(async () => {
    if (!user) return;
    try {
      const next = await listMyLinkedinAccountsAction({
        currentUserId: user.$id,
      });
      setAccounts(next);
      if (!selectedAccountId && next.length > 0) {
        setSelectedAccountId(next[0].$id);
      }
    } catch (error: unknown) {
      toast({
        title: "Failed to load Linkedin IDs",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setAccounts([]);
    }
  }, [selectedAccountId, toast, user]);

  const loadRequests = useCallback(async () => {
    if (!user || !selectedAccountId) return;
    try {
      setLoadingList(true);
      const next = await listMyLinkedinRequestsForAccountAction({
        currentUserId: user.$id,
        accountId: selectedAccountId,
        limit: 100,
      });
      setRequests(next);
    } catch {
      setRequests([]);
    } finally {
      setLoadingList(false);
    }
  }, [selectedAccountId, user]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    setIsDuplicate(null);
    void loadRequests();
  }, [loadRequests, selectedAccountId]);

  const onCheck = async () => {
    if (!user) return;
    if (!selectedAccount) {
      toast({
        title: "Select an account",
        description: "Please select a Linkedin ID first",
        variant: "destructive",
      });
      return;
    }

    const today = todayDateInputValue();
    if (dateSent !== today) {
      toast({
        title: "Old date not allowed",
        description: "You can add new requests only for today's date.",
        variant: "destructive",
      });
      return;
    }

    if (!targetUrl.trim()) {
      toast({
        title: "URL required",
        description: "Paste the Linkedin profile URL",
        variant: "destructive",
      });
      return;
    }

    try {
      setChecking(true);
      setHistoryLoading(true);
      const result = await checkLinkedinDuplicateAction({
        currentUserId: user.$id,
        company: selectedAccount.company,
        targetUrl,
      });
      setIsDuplicate(result.isDuplicate);
      const history = await getLinkedinConnectionHistoryAction({
        currentUserId: user.$id,
        targetUrl,
      });
      setHistoryData(history);
      setHistoryTargetUrl(targetUrl.trim());
      setHistoryOpen(true);
      toast({
        title: result.isDuplicate ? "History loaded (resend)" : "History loaded",
        description: result.isDuplicate
          ? "This URL already exists for this company. Adding will resend it."
          : "No active request for this company. You can add now.",
      });
    } catch (error: unknown) {
      toast({
        title: "Check failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setIsDuplicate(null);
    } finally {
      setChecking(false);
      setHistoryLoading(false);
    }
  };

  const onAdd = async () => {
    if (!user) return;
    if (!selectedAccount) return;

    if (dateSent !== today) {
      toast({
        title: "Old date not allowed",
        description: "You can add new requests only for today's date.",
        variant: "destructive",
      });
      return;
    }

    if (remainingToday !== null && remainingToday <= 0) {
      toast({
        title: "Limit reached",
        description: "Daily connection limit reached for this Linkedin ID.",
        variant: "destructive",
      });
      return;
    }

    try {
      setAdding(true);
      const result = await createLinkedinRequestAction({
        currentUserId: user.$id,
        accountId: selectedAccount.$id,
        dateSent,
        targetUrl,
      });
      toast({
        title: result.mode === "resent" ? "Resent" : "Added",
        description:
          result.mode === "resent"
            ? "Existing request updated and reassigned."
            : "Linkedin request saved.",
      });
      setTargetUrl("");
      setIsDuplicate(null);
      await loadRequests();
    } catch (error: unknown) {
      toast({
        title: "Failed to add",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const markAccepted = async (requestId: string) => {
    if (!user) return;
    try {
      await markLinkedinRequestAcceptedAction({
        currentUserId: user.$id,
        requestId,
      });
      toast({
        title: "Accepted",
        description: "Marked as accepted.",
        variant: "success",
      });
      await loadRequests();
    } catch (error: unknown) {
      toast({
        title: "Failed to update",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const withdraw = async (requestId: string) => {
    if (!user) return;
    try {
      setWithdrawingId(requestId);
      await withdrawLinkedinRequestAction({
        currentUserId: user.$id,
        requestId,
      });
      toast({
        title: "Withdrawn",
        description: "Request withdrawn. Others can send this URL for the same company now.",
      });
      await loadRequests();
    } catch (error: unknown) {
      toast({
        title: "Withdraw failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    const normalizedUrl = filterUrl.trim().toLowerCase();
    return requests.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterDate) {
        const sent = new Date(r.dateSent);
        const sentValue = Number.isNaN(sent.getTime())
          ? ""
          : `${sent.getFullYear()}-${String(sent.getMonth() + 1).padStart(2, "0")}-${String(sent.getDate()).padStart(2, "0")}`;
        if (sentValue !== filterDate) return false;
      }
      if (normalizedUrl) {
        if (!r.targetUrl.toLowerCase().includes(normalizedUrl)) return false;
      }
      return true;
    });
  }, [filterDate, filterStatus, filterUrl, requests]);

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Linkedin Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {accounts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No Linkedin IDs assigned to your account yet. Please ask your Team
              Lead / Admin to assign a Main ID (and optional Sudo IDs).
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Linkedin Account <RequiredMark />
                </Label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                  {accounts.map((a) => (
                    <option key={a.$id} value={a.$id}>
                      {a.accountType.toUpperCase()} · {a.idName} · {a.company}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>
                  Date <RequiredMark />
                </Label>
                <DatePicker
                  value={dateSent}
                  onChange={setDateSent}
                  minDate={today}
                  maxDate={today}
                />
              </div>
            </div>
          )}

          {accounts.length > 0 && selectedAccount && (
            <div className="text-sm text-muted-foreground">
              {selectedAccount.licenseType ? `License: ${selectedAccount.licenseType} · ` : ""}
              {dailyLimit === null
                ? "Limit: Not set (ask Team Lead/Admin)"
                : `Limit: ${dailyLimit} · Used today: ${usedToday} · Remaining: ${remainingToday}`}
            </div>
          )}

          {accounts.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>
                  Linkedin Profile URL <RequiredMark />
                </Label>
                <Input
                  value={targetUrl}
                  onChange={(e) => {
                    setTargetUrl(e.target.value);
                    setIsDuplicate(null);
                  }}
                  placeholder="Paste profile URL"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={onCheck}
                  disabled={checking || !selectedAccount}>
                  {checking ? "Checking..." : "Check"}
                </Button>
                {isDuplicate === false && (
                  <Button onClick={onAdd} disabled={adding}>
                    {adding ? "Adding..." : "Add"}
                  </Button>
                )}
                {isDuplicate === null && (
                  <span className="text-sm text-muted-foreground">
                    Click Check to confirm duplicate (Company + URL).
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <DatePicker
                value={filterDate}
                onChange={setFilterDate}
                placeholder="Any date"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(
                    e.target.value as "all" | "sent" | "accepted" | "withdrawn",
                  )
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="all">All</option>
                <option value="sent">Not Accepted</option>
                <option value="accepted">Accepted</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input
                value={filterUrl}
                onChange={(e) => setFilterUrl(e.target.value)}
                placeholder="Search URL"
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingList ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-sm text-muted-foreground">
                    No requests found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((r) => {
                  const daysPassed = daysSinceDateInputValue(r.dateSent);
                  const daysLeft = Math.max(
                    LINKEDIN_ACCEPT_WINDOW_DAYS - daysPassed,
                    0,
                  );
                  const notAcceptedLabel =
                    daysLeft > 0
                      ? `Not Accepted - ${daysLeft} days left`
                      : "Not Accepted - 0 days left";
                  const canWithdraw =
                    r.status === "sent" && (r.isActive ?? true) && daysLeft === 0;
                  const statusLabel =
                    r.status === "accepted"
                      ? "Accepted"
                      : r.status === "withdrawn" || r.isActive === false
                        ? "Withdrawn"
                        : notAcceptedLabel;

                  return (
                    <TableRow key={r.$id}>
                    <TableCell className="break-all">{r.targetUrl}</TableCell>
                    <TableCell>
                      {new Date(r.dateSent).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{statusLabel}</TableCell>
                    <TableCell>
                      {r.status === "accepted" ? (
                        <div className="flex flex-wrap gap-2">
                          {r.leadId ? (
                            <Button
                              variant="outline"
                              onClick={() => router.push(`/leads/${encodeURIComponent(r.leadId!)}`)}
                            >
                              Open Lead
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() =>
                                router.push(
                                  `/leads/new?linkedinRequestId=${encodeURIComponent(r.$id)}&linkedinTargetUrl=${encodeURIComponent(r.targetUrl)}`,
                                )
                              }
                            >
                              Create Lead
                            </Button>
                          )}
                          <span className="text-sm text-muted-foreground">
                            Accepted{" "}
                            {r.acceptedAt
                              ? `(${new Date(r.acceptedAt).toLocaleDateString()})`
                              : ""}
                          </span>
                        </div>
                      ) : r.status === "sent" && (r.isActive ?? true) ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => markAccepted(r.$id)}>
                            Connection Accepted
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!canWithdraw || withdrawingId === r.$id}
                            onClick={() => withdraw(r.$id)}>
                            {withdrawingId === r.$id ? "Withdrawing..." : "Withdraw"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-2xl sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Connection History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm break-all">{historyTargetUrl}</div>
              {historyLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : !historyData || historyData.histories.length === 0 ? (
                <div className="text-sm text-muted-foreground">No history found.</div>
              ) : (
                <div className="space-y-4 max-h-[60vh] overflow-auto">
                  {historyData.histories.map((h) => (
                    <div key={h.request.$id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="text-sm font-medium">{h.request.company}</div>
                        <div className="text-sm text-muted-foreground">
                          {h.request.status}
                          {h.request.leadId ? ` • Lead: ${h.request.leadId}` : ""}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {h.logs.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No events.</div>
                        ) : (
                          h.logs.map((log) => (
                            <div key={log.$id} className="text-sm">
                              <span className="font-medium">{log.actorName}</span>{" "}
                              <span className="text-muted-foreground">{log.action}</span>{" "}
                              <span className="text-muted-foreground">
                                {log.performedAt
                                  ? `(${new Date(log.performedAt).toLocaleString()})`
                                  : ""}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setHistoryOpen(false)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function LinkedinRequestsPage() {
  return (
    <ProtectedRoute componentKey="linkedin-requests">
      <LinkedinRequestsContent />
    </ProtectedRoute>
  );
}
