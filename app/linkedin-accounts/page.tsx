"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  listAgentsForTeamLeadLinkedinAction,
  listLinkedinAccountsForManagementAction,
  listTeamLeadsForLinkedinAction,
  upsertLinkedinAccountAction,
} from "@/app/actions/linkedin";
import type { LinkedinAccount, LinkedinAccountType, User } from "@/lib/types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again";
}

function RequiredMark() {
  return <span className="text-red-500">*</span>;
}

function LinkedinAccountsContent() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [teamLeads, setTeamLeads] = useState<User[]>([]);
  const [teamLeadId, setTeamLeadId] = useState<string>("");
  const [agents, setAgents] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<LinkedinAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [company, setCompany] = useState("");
  const [idName, setIdName] = useState("");
  const [licenseType, setLicenseType] = useState("");
  const [connectionLimit, setConnectionLimit] = useState<string>("0");
  const [accountType, setAccountType] = useState<LinkedinAccountType>("main");
  const [mainAccountId, setMainAccountId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const companyOptions = useMemo(
    () => ["SilverSpace Inc.", "Vizva Inc.", "Flawless-ED"],
    [],
  );
  const licenseTypeOptions = useMemo(
    () => [
      "Normal",
      "LinkedIn Premium",
      "LinkedIn Recruiter Lite",
      "LinkedIn Recruiter Plus",
      "LinkedIn Sales Navigator",
    ],
    [],
  );

  const agentsMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.$id, a.name));
    return map;
  }, [agents]);

  const mainAccountsForSelectedAgent = useMemo(() => {
    if (!assignedUserId) return [];
    return accounts.filter(
      (a) => a.assignedUserId === assignedUserId && a.accountType === "main",
    );
  }, [accounts, assignedUserId]);

  const loadTeamLeads = useCallback(async () => {
    if (!user || !isAdmin) return;
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
  }, [isAdmin, teamLeadId, toast, user]);

  const loadAgents = useCallback(async () => {
    if (!user) return;
    if (isAdmin && !teamLeadId) return;
    try {
      const next = await listAgentsForTeamLeadLinkedinAction({
        currentUserId: user.$id,
        teamLeadId: isAdmin ? teamLeadId : undefined,
      });
      setAgents(next);
      if (!assignedUserId && next.length > 0) {
        setAssignedUserId(next[0].$id);
      }
    } catch (error: unknown) {
      toast({
        title: "Failed to load agents",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setAgents([]);
    }
  }, [assignedUserId, isAdmin, teamLeadId, toast, user]);

  const loadAccounts = useCallback(async () => {
    if (!user) return;
    if (isAdmin && !teamLeadId) return;
    try {
      setLoading(true);
      const next = await listLinkedinAccountsForManagementAction({
        currentUserId: user.$id,
        teamLeadId: isAdmin ? teamLeadId : null,
      });
      setAccounts(next);
    } catch (error: unknown) {
      toast({
        title: "Failed to load accounts",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, teamLeadId, toast, user]);

  useEffect(() => {
    void loadTeamLeads();
  }, [loadTeamLeads]);

  useEffect(() => {
    void loadAgents();
    void loadAccounts();
  }, [loadAccounts, loadAgents, teamLeadId]);

  useEffect(() => {
    if (accountType === "main") {
      setMainAccountId("");
    } else if (mainAccountsForSelectedAgent.length === 1) {
      setMainAccountId(mainAccountsForSelectedAgent[0].$id);
    }
  }, [accountType, mainAccountsForSelectedAgent]);

  const startEdit = (account: LinkedinAccount) => {
    setEditingId(account.$id);
    setAssignedUserId(account.assignedUserId);
    setCompany((account.company ?? "").trim());
    setIdName(account.idName);
    setLicenseType((account.licenseType ?? "").trim());
    setConnectionLimit(
      typeof account.connectionLimit === "number"
        ? String(account.connectionLimit)
        : "0",
    );
    setAccountType(account.accountType);
    setMainAccountId(account.mainAccountId ?? "");
  };

  const resetForm = () => {
    setEditingId(null);
    setCompany("");
    setIdName("");
    setLicenseType("");
    setConnectionLimit("0");
    setAccountType("main");
    setMainAccountId("");
  };

  const onSave = async () => {
    if (!user) return;
    if (!assignedUserId) {
      toast({
        title: "Agent required",
        description: "Select an agent first",
        variant: "destructive",
      });
      return;
    }

    const parsedLimit = Number.parseInt(connectionLimit || "0", 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      toast({
        title: "Invalid limit",
        description: "Connection limit must be 0 or more.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      await upsertLinkedinAccountAction({
        currentUserId: user.$id,
        accountId: editingId ?? undefined,
        assignedUserId,
        company,
        idName,
        accountType,
        licenseType,
        connectionLimit: parsedLimit,
        mainAccountId: accountType === "sudo" ? mainAccountId : null,
        isActive: true,
      });
      toast({ title: "Saved", description: "Linkedin ID updated." });
      resetForm();
      await loadAccounts();
    } catch (error: unknown) {
      toast({
        title: "Save failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Manage Linkedin IDs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isAdmin && (
            <div className="space-y-2">
              <Label>Team Lead</Label>
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
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Agent <RequiredMark />
              </Label>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {agents.map((a) => (
                  <option key={a.$id} value={a.$id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>
                Account Type <RequiredMark />
              </Label>
              <select
                value={accountType}
                onChange={(e) =>
                  setAccountType(e.target.value as LinkedinAccountType)
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option value="main">Main</option>
                <option value="sudo">Sudo</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>
                Company <RequiredMark />
              </Label>
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select company</option>
                {companyOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>
                ID Name <RequiredMark />
              </Label>
              <Input
                value={idName}
                onChange={(e) => setIdName(e.target.value)}
                placeholder="Linkedin ID name"
              />
            </div>

            <div className="space-y-2">
              <Label>
                License Type <RequiredMark />
              </Label>
              <select
                value={licenseType}
                onChange={(e) => setLicenseType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select license type</option>
                {licenseTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>
                Daily Connection Limit <RequiredMark />
              </Label>
              <Input
                type="number"
                min={0}
                value={connectionLimit}
                onChange={(e) => setConnectionLimit(e.target.value)}
                placeholder="0"
              />
            </div>

            {accountType === "sudo" && (
              <div className="space-y-2 md:col-span-2">
                <Label>
                  Main ID <RequiredMark />
                </Label>
                <select
                  value={mainAccountId}
                  onChange={(e) => setMainAccountId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                  <option value="">Select Main ID</option>
                  {mainAccountsForSelectedAgent.map((a) => (
                    <option key={a.$id} value={a.$id}>
                      {a.idName} · {a.company}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
            <Button variant="outline" onClick={resetForm} disabled={saving}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned IDs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>ID Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead className="w-[140px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : accounts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-sm text-muted-foreground">
                    No Linkedin IDs created yet.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((a) => (
                  <TableRow key={a.$id}>
                    <TableCell>
                      {agentsMap.get(a.assignedUserId) ?? a.assignedUserId}
                    </TableCell>
                    <TableCell>{a.company}</TableCell>
                    <TableCell>{a.idName}</TableCell>
                    <TableCell className="uppercase">{a.accountType}</TableCell>
                    <TableCell>{a.licenseType || "-"}</TableCell>
                    <TableCell>
                      {typeof a.connectionLimit === "number"
                        ? a.connectionLimit
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" onClick={() => startEdit(a)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LinkedinAccountsPage() {
  return (
    <ProtectedRoute componentKey="linkedin-account-management">
      <LinkedinAccountsContent />
    </ProtectedRoute>
  );
}
