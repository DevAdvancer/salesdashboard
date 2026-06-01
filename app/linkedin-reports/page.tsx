"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-picker";
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
  getLinkedinWeeklyReportAction,
  listLinkedinRequestsForAdminAction,
  listAgentsForTeamLeadLinkedinAction,
  listLinkedinAccountsForManagementAction,
  listTeamLeadsForLinkedinAction,
} from "@/app/actions/linkedin";
import type { LinkedinAccount, LinkedinRequest, User } from "@/lib/types";
import { Input } from "@/components/ui/input";

function dateInputValueFromDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sevenDayRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start, end };
}

type ReportRow = {
  agentId: string;
  accountId: string;
  company: string;
  idName: string;
  accountType: string;
  sent: number;
  accepted: number;
  notAccepted: number;
  withdrawn: number;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again";
}

function RequiredMark() {
  return <span className="text-red-500">*</span>;
}

function LinkedinReportsContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [teamLeads, setTeamLeads] = useState<User[]>([]);
  const [teamLeadId, setTeamLeadId] = useState<string>("");
  const initial = useMemo(() => sevenDayRange(), []);
  const [range, setRange] = useState<{ from?: string; to?: string }>({
    from: dateInputValueFromDate(initial.start),
    to: dateInputValueFromDate(initial.end),
  });
  const [agents, setAgents] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<LinkedinAccount[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requests, setRequests] = useState<LinkedinRequest[]>([]);
  const [requestStatus, setRequestStatus] = useState<
    "all" | "sent" | "accepted" | "withdrawn"
  >("all");
  const [requestUrl, setRequestUrl] = useState("");
  const [requestAgentId, setRequestAgentId] = useState<string>("");

  const agentsMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.$id, a.name));
    return map;
  }, [agents]);

  const accountsMap = useMemo(() => {
    const map = new Map<string, LinkedinAccount>();
    accounts.forEach((account) => map.set(account.$id, account));
    return map;
  }, [accounts]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const aName = agentsMap.get(a.agentId) ?? a.agentId;
      const bName = agentsMap.get(b.agentId) ?? b.agentId;
      return (
        aName.localeCompare(bName) ||
        a.company.localeCompare(b.company) ||
        a.idName.localeCompare(b.idName) ||
        a.accountId.localeCompare(b.accountId)
      );
    });
    return copy;
  }, [agentsMap, rows]);

  const loadTeamLeads = useCallback(async () => {
    if (!user) return;
    if (user.role === "team_lead") {
      setTeamLeads([]);
      setTeamLeadId(user.$id);
      return;
    }
    try {
      const next = await listTeamLeadsForLinkedinAction({
        currentUserId: user.$id,
      });
      setTeamLeads(next);
      if (!teamLeadId && next.length > 0) {
        setTeamLeadId(next[0].$id);
      }
    } catch (error: unknown) {
      toast({
        title: "Failed to load team leads",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setTeamLeads([]);
    }
  }, [teamLeadId, toast, user]);

  const loadAgents = useCallback(async () => {
    if (!user || !teamLeadId) return;
    try {
      const next = await listAgentsForTeamLeadLinkedinAction({
        currentUserId: user.$id,
        teamLeadId,
      });
      setAgents(next);
    } catch {
      setAgents([]);
    }
  }, [teamLeadId, user]);

  const loadAccounts = useCallback(async () => {
    if (!user || !teamLeadId) return;
    try {
      const next = await listLinkedinAccountsForManagementAction({
        currentUserId: user.$id,
        teamLeadId,
      });
      setAccounts(next);
    } catch {
      setAccounts([]);
    }
  }, [teamLeadId, user]);

  const loadReport = useCallback(async () => {
    if (!user || !teamLeadId) return;
    if (!range.from) return;
    const startDate = range.from;
    const endDate = range.to ?? range.from;
    try {
      setLoading(true);
      const result = await getLinkedinWeeklyReportAction({
        currentUserId: user.$id,
        teamLeadId,
        startDate,
        endDate,
      });
      setRows(result.rows as unknown as ReportRow[]);
    } catch (error: unknown) {
      toast({
        title: "Failed to load report",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, teamLeadId, toast, user]);

  const loadRequests = useCallback(async () => {
    if (!user || !teamLeadId) return;
    if (!range.from) return;
    const startDate = range.from;
    const endDate = range.to ?? range.from;

    try {
      setRequestsLoading(true);
      const next = await listLinkedinRequestsForAdminAction({
        currentUserId: user.$id,
        teamLeadId,
        startDate,
        endDate,
        status: requestStatus,
        agentId: requestAgentId || undefined,
      });
      setRequests(next);
    } catch (error: unknown) {
      toast({
        title: "Failed to load requests",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, [
    range.from,
    range.to,
    requestAgentId,
    requestStatus,
    teamLeadId,
    toast,
    user,
  ]);

  useEffect(() => {
    void loadTeamLeads();
  }, [loadTeamLeads]);

  useEffect(() => {
    void loadAgents();
    void loadAccounts();
  }, [loadAccounts, loadAgents]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.sent += r.sent;
        acc.accepted += r.accepted;
        acc.notAccepted += r.notAccepted;
        acc.withdrawn += r.withdrawn;
        return acc;
      },
      { sent: 0, accepted: 0, notAccepted: 0, withdrawn: 0 },
    );
  }, [rows]);

  const visibleRequests = useMemo(() => {
    const query = requestUrl.trim().toLowerCase();
    if (!query) return requests;
    return requests.filter((r) => r.targetUrl.toLowerCase().includes(query));
  }, [requestUrl, requests]);

  const sortedRequests = useMemo(() => {
    const copy = [...visibleRequests];
    copy.sort((a, b) => {
      const aName = agentsMap.get(a.agentId) ?? a.agentId;
      const bName = agentsMap.get(b.agentId) ?? b.agentId;
      const aDate = a.dateSent ?? "";
      const bDate = b.dateSent ?? "";
      return (
        aName.localeCompare(bName) ||
        bDate.localeCompare(aDate) ||
        a.company.localeCompare(b.company) ||
        a.accountId.localeCompare(b.accountId) ||
        a.targetUrl.localeCompare(b.targetUrl)
      );
    });
    return copy;
  }, [agentsMap, visibleRequests]);

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Linkedin Reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Team Lead <RequiredMark />
              </Label>
              {user.role === "admin" ? (
                <select
                  value={teamLeadId}
                  onChange={(e) => setTeamLeadId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                  {teamLeads.map((tl) => (
                    <option key={tl.$id} value={tl.$id}>
                      {tl.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground">
                  {user.name}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                Date Range <RequiredMark />
              </Label>
              <DateRangePicker value={range} onChange={setRange} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={loadReport} disabled={loading || !teamLeadId}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <div className="text-sm text-muted-foreground">
              Sent: {totals.sent} · Accepted: {totals.accepted} · Not Accepted:{" "}
              {totals.notAccepted} · Withdrawn: {totals.withdrawn}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Not Accepted</TableHead>
                <TableHead>Withdrawn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-sm text-muted-foreground">
                    No data for this date range.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((r, index) => {
                  const previousAgentId =
                    index > 0 ? sortedRows[index - 1].agentId : null;
                  const shouldShowAgent = previousAgentId !== r.agentId;
                  return (
                    <TableRow key={`${r.agentId}-${r.accountId}`}>
                      <TableCell>
                        {shouldShowAgent
                          ? (agentsMap.get(r.agentId) ?? "Agent")
                          : ""}
                      </TableCell>
                      <TableCell>{r.company}</TableCell>
                      <TableCell>{r.idName}</TableCell>
                      <TableCell className="uppercase">
                        {r.accountType}
                      </TableCell>
                      <TableCell>{r.sent}</TableCell>
                      <TableCell>{r.accepted}</TableCell>
                      <TableCell>{r.notAccepted}</TableCell>
                      <TableCell>{r.withdrawn}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requests (Admin)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                value={requestStatus}
                onChange={(e) =>
                  setRequestStatus(
                    e.target.value as "all" | "sent" | "accepted" | "withdrawn",
                  )
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option value="all">All</option>
                <option value="sent">Not Accepted</option>
                <option value="accepted">Accepted</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Agent</Label>
              <select
                value={requestAgentId}
                onChange={(e) => setRequestAgentId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option value="">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.$id} value={agent.$id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>URL</Label>
              <Input
                value={requestUrl}
                onChange={(e) => setRequestUrl(e.target.value)}
                placeholder="Search URL"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={loadRequests}
              disabled={requestsLoading || !teamLeadId}>
              {requestsLoading ? "Loading..." : "Refresh Requests"}
            </Button>
            <div className="text-sm text-muted-foreground">
              Total: {sortedRequests.length}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestsLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : sortedRequests.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-sm text-muted-foreground">
                    No requests found.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRequests.map((r, index) => {
                  const prevAgentId =
                    index > 0 ? sortedRequests[index - 1].agentId : null;
                  const showAgent = prevAgentId !== r.agentId;
                  const account = accountsMap.get(r.accountId);
                  const statusLabel =
                    r.status === "accepted"
                      ? "Accepted"
                      : r.status === "withdrawn" || r.isActive === false
                        ? "Withdrawn"
                        : "Not Accepted";
                  return (
                    <TableRow key={r.$id}>
                      <TableCell>
                        {showAgent
                          ? (agentsMap.get(r.agentId) ?? r.agentId)
                          : ""}
                      </TableCell>
                      <TableCell>{account?.idName ?? r.accountId}</TableCell>
                      <TableCell>{account?.company ?? r.company}</TableCell>
                      <TableCell className="break-all">{r.targetUrl}</TableCell>
                      <TableCell>
                        {new Date(r.dateSent).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{statusLabel}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LinkedinReportsPage() {
  return (
    <ProtectedRoute componentKey="linkedin-reports">
      <LinkedinReportsContent />
    </ProtectedRoute>
  );
}
