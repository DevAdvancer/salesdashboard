"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { DatePicker } from "@/components/ui/date-picker";
import {
  assignAttendanceDelegateAction,
  checkAndNotifyAdminAttendanceEscalationsAction,
  checkAndNotifyMyTeamAbsencesAction,
  getAttendanceFlagSummaryAction,
  listMyTeamAttendanceAction,
  listTeamLeadsAttendanceForAdminAction,
  markAttendancePresentByTeamLeadAction,
} from "@/app/actions/attendance";

type TeamAttendanceResult = Awaited<
  ReturnType<typeof listMyTeamAttendanceAction>
>;
type AttendanceRow = TeamAttendanceResult["rows"][number];
type TeamLeadAttendanceRow = Awaited<
  ReturnType<typeof listTeamLeadsAttendanceForAdminAction>
>["rows"][number];

export default function AttendancePage() {
  return (
    <ProtectedRoute componentKey="attendance">
      <AttendanceContent />
    </ProtectedRoute>
  );
}

function AttendanceContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(true);
  const [isAssigningForUserId, setIsAssigningForUserId] = useState<
    string | null
  >(null);
  const [remarkDialog, setRemarkDialog] = useState<null | {
    kind: "assign_agent" | "assign_team_lead" | "mark_present";
    userId: string;
  }>(null);
  const [remarkText, setRemarkText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState<string>("");
  const [selectedDateKey, setSelectedDateKey] = useState<string>("");
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string>("");
  const [teamLeadRows, setTeamLeadRows] = useState<TeamLeadAttendanceRow[]>([]);
  const [teamLeadDelegateOptions, setTeamLeadDelegateOptions] = useState<
    Array<{ userId: string; userName: string }>
  >([]);
  const [teamLeadPendingDelegateByUserId, setTeamLeadPendingDelegateByUserId] =
    useState<Record<string, string>>({});
  const [teamAttendance, setTeamAttendance] =
    useState<TeamAttendanceResult | null>(null);
  const [flagSummary, setFlagSummary] = useState<null | Awaited<
    ReturnType<typeof getAttendanceFlagSummaryAction>
  >>(null);
  const [pendingDelegateByAbsentUserId, setPendingDelegateByAbsentUserId] =
    useState<Record<string, string>>({});

  const delegateNameById = useMemo(() => {
    const map = new Map<string, string>();
    (teamAttendance?.delegateOptions ?? []).forEach((d) =>
      map.set(d.userId, d.userName),
    );
    return map;
  }, [teamAttendance?.delegateOptions]);

  const teamLeadNameById = useMemo(() => {
    const map = new Map<string, string>();
    teamLeadDelegateOptions.forEach((d) => map.set(d.userId, d.userName));
    return map;
  }, [teamLeadDelegateOptions]);

  const todayKey = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }, []);

  const isPastSelectedDate =
    Boolean(selectedDateKey) &&
    selectedDateKey < todayKey &&
    user?.role !== "admin";

  const loadOverview = useCallback(async () => {
    if (!user) return;
    if (user.role === "admin") {
      setOverviewLoading(true);
    } else {
      setTeamLoading(true);
    }
    setError(null);
    try {
      if (user.role === "team_lead") {
        void checkAndNotifyMyTeamAbsencesAction({ currentUserId: user.$id }).catch(
          () => {},
        );
        const [result, summary] = await Promise.all([
          listMyTeamAttendanceAction({
            currentUserId: user.$id,
            dateKey: selectedDateKey || undefined,
          }),
          getAttendanceFlagSummaryAction({
            currentUserId: user.$id,
            referenceDateKey: selectedDateKey || undefined,
          }),
        ]);
        setDateKey(result.dateKey);
        setSelectedDateKey((prev) => prev || result.dateKey);
        setTeamAttendance(result);
        setFlagSummary(summary);
        setPendingDelegateByAbsentUserId((prev) => {
          const next: Record<string, string> = { ...prev };
          result.rows.forEach((r) => {
            if (r.delegateUserId) {
              next[r.userId] = r.delegateUserId;
            } else if (!(r.userId in next)) {
              next[r.userId] = "";
            }
          });
          return next;
        });
      } else if (user.role === "admin") {
        void checkAndNotifyAdminAttendanceEscalationsAction({
          currentUserId: user.$id,
        }).catch(() => {});
        const overview = await listTeamLeadsAttendanceForAdminAction({
          currentUserId: user.$id,
          dateKey: selectedDateKey || undefined,
        });
        setDateKey(overview.dateKey);
        setSelectedDateKey((prev) => prev || overview.dateKey);
        setTeamLeadRows(overview.rows);
        setTeamLeadDelegateOptions(overview.delegateOptions);
        setTeamLeadPendingDelegateByUserId((prev) => {
          const next: Record<string, string> = { ...prev };
          overview.rows.forEach((r) => {
            if (r.delegateUserId) {
              next[r.userId] = r.delegateUserId;
            } else if (!(r.userId in next)) {
              next[r.userId] = "";
            }
          });
          return next;
        });
        setSelectedTeamLeadId((current) => {
          if (current && overview.rows.some((r) => r.userId === current)) {
            return current;
          }
          return overview.rows[0]?.userId ?? "";
        });
      } else {
        setTeamAttendance(null);
        setTeamLeadRows([]);
        setFlagSummary(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load attendance");
    } finally {
      if (user.role === "admin") {
        setOverviewLoading(false);
      } else {
        setTeamLoading(false);
      }
    }
  }, [selectedDateKey, user]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadTeamAttendanceOnly = useCallback(async () => {
    if (!user) return;

    if (user.role === "team_lead") {
      await loadOverview();
      return;
    }

    if (user.role !== "admin") {
      return;
    }

    if (!selectedTeamLeadId) {
      setTeamAttendance(null);
      setFlagSummary(null);
      return;
    }

    setTeamLoading(true);
    setError(null);
    try {
      const [result, summary] = await Promise.all([
        listMyTeamAttendanceAction({
          currentUserId: user.$id,
          teamLeadId: selectedTeamLeadId,
          dateKey: selectedDateKey || undefined,
        }),
        getAttendanceFlagSummaryAction({
          currentUserId: user.$id,
          teamLeadId: selectedTeamLeadId,
          referenceDateKey: selectedDateKey || undefined,
        }),
      ]);
      setTeamAttendance(result);
      setFlagSummary(summary);
      setPendingDelegateByAbsentUserId((prev) => {
        const next: Record<string, string> = { ...prev };
        result.rows.forEach((r) => {
          if (r.delegateUserId) {
            next[r.userId] = r.delegateUserId;
          } else if (!(r.userId in next)) {
            next[r.userId] = "";
          }
        });
        return next;
      });
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load team attendance",
      );
    } finally {
      setTeamLoading(false);
    }
  }, [loadOverview, selectedDateKey, selectedTeamLeadId, user]);

  const handleAssign = async (absentUserId: string, remark: string) => {
    if (!user) return;
    const delegateUserIdRaw = pendingDelegateByAbsentUserId[absentUserId] ?? "";
    const delegateUserId = delegateUserIdRaw ? delegateUserIdRaw : null;

    setIsAssigningForUserId(absentUserId);
    try {
      await assignAttendanceDelegateAction({
        currentUserId: user.$id,
        absentUserId,
        delegateUserId,
        dateKey: selectedDateKey || undefined,
        remark,
      });
      toast({
        title: "Success",
        description: delegateUserId
          ? `Assigned ${delegateNameById.get(delegateUserId) ?? "agent"} to cover. Remark: ${remark}`
          : `Assignment cleared. Remark: ${remark}`,
      });
      if (user.role === "admin") {
        await loadTeamAttendanceOnly();
      } else {
        await loadOverview();
      }
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to assign",
        variant: "destructive",
      });
    } finally {
      setIsAssigningForUserId(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (user.role !== "admin") return;
    if (!selectedTeamLeadId) return;
    void loadTeamAttendanceOnly();
  }, [loadTeamAttendanceOnly, selectedTeamLeadId, user]);

  const handleAssignTeamLead = async (teamLeadId: string, remark: string) => {
    if (!user) return;
    const delegateUserIdRaw = teamLeadPendingDelegateByUserId[teamLeadId] ?? "";
    const delegateUserId = delegateUserIdRaw ? delegateUserIdRaw : null;

    setIsAssigningForUserId(teamLeadId);
    try {
      await assignAttendanceDelegateAction({
        currentUserId: user.$id,
        absentUserId: teamLeadId,
        delegateUserId,
        dateKey: selectedDateKey || undefined,
        remark,
      });
      toast({
        title: "Success",
        description: delegateUserId
          ? `Assigned ${teamLeadNameById.get(delegateUserId) ?? "team lead"} to cover. Remark: ${remark}`
          : `Assignment cleared. Remark: ${remark}`,
      });
      await loadOverview();
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to assign",
        variant: "destructive",
      });
    } finally {
      setIsAssigningForUserId(null);
    }
  };

  const openRemarkDialog = (next: {
    kind: "assign_agent" | "assign_team_lead" | "mark_present";
    userId: string;
  }) => {
    setRemarkText("");
    setRemarkDialog(next);
  };

  const submitRemarkDialog = async () => {
    if (!user || !remarkDialog) return;
    const remark = remarkText.trim();
    if (!remark) {
      toast({
        title: "Remark Required",
        description: "Please enter a remark before saving.",
        variant: "destructive",
      });
      return;
    }

    const userId = remarkDialog.userId;
    const isTeamLeadTarget =
      user.role === "admin" &&
      teamLeadRows.some((row) => row.userId === userId);
    setIsAssigningForUserId(userId);
    try {
      if (remarkDialog.kind === "mark_present") {
        await markAttendancePresentByTeamLeadAction({
          currentUserId: user.$id,
          userId,
          dateKey: selectedDateKey || undefined,
          remark,
        });
        toast({
          title: "Success",
          description: `Marked as present. Remark: ${remark}`,
        });
      } else if (remarkDialog.kind === "assign_team_lead") {
        const delegateUserIdRaw = teamLeadPendingDelegateByUserId[userId] ?? "";
        const delegateUserId = delegateUserIdRaw ? delegateUserIdRaw : null;
        await assignAttendanceDelegateAction({
          currentUserId: user.$id,
          absentUserId: userId,
          delegateUserId,
          dateKey: selectedDateKey || undefined,
          remark,
        });
        toast({
          title: "Success",
          description: delegateUserId
            ? `Assigned ${teamLeadNameById.get(delegateUserId) ?? "team lead"} to cover. Remark: ${remark}`
            : `Assignment cleared. Remark: ${remark}`,
        });
      } else {
        const delegateUserIdRaw = pendingDelegateByAbsentUserId[userId] ?? "";
        const delegateUserId = delegateUserIdRaw ? delegateUserIdRaw : null;
        await assignAttendanceDelegateAction({
          currentUserId: user.$id,
          absentUserId: userId,
          delegateUserId,
          dateKey: selectedDateKey || undefined,
          remark,
        });
        toast({
          title: "Success",
          description: delegateUserId
            ? `Assigned ${delegateNameById.get(delegateUserId) ?? "agent"} to cover. Remark: ${remark}`
            : `Assignment cleared. Remark: ${remark}`,
        });
      }
      setRemarkDialog(null);
      setRemarkText("");
      if (user.role === "admin" && isTeamLeadTarget) {
        await loadOverview();
      } else {
        await loadTeamAttendanceOnly();
      }
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setIsAssigningForUserId(null);
    }
  };

  if (!user) return null;

  return (
    <div className="container mx-auto">
      <div className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Attendance</h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">Date (ET): {dateKey || "—"}</p>
            <div className="max-w-xs">
              <Label htmlFor="attendance-date">Select Date</Label>
              <DatePicker
                id="attendance-date"
                value={selectedDateKey}
                onChange={setSelectedDateKey}
                maxDate={todayKey}
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadTeamAttendanceOnly}
            disabled={
              teamLoading || (user.role === "admin" && !selectedTeamLeadId)
            }>
            {teamLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {user.role === "admin" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Team Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {overviewLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {!overviewLoading && error && (
              <div className="p-3 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
                {error}
              </div>
            )}
            {!overviewLoading && !error && teamLeadRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No team leads found.
              </p>
            )}
            {!overviewLoading && !error && teamLeadRows.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3">Team Lead</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-left p-3">Present At</th>
                        <th className="text-left p-3">Assign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamLeadRows.map((row) => {
                        const status = row.present ? "Present" : "Absent";
                        const assignedValue =
                          teamLeadPendingDelegateByUserId[row.userId] ?? "";
                        const isAssigning = isAssigningForUserId === row.userId;
                        return (
                          <tr key={row.userId} className="border-b">
                            <td className="p-3">{row.userName}</td>
                            <td className="p-3">
                              <span
                                className={`inline-flex px-2 py-1 rounded-full text-xs ${
                                  row.present
                                    ? "bg-green-100 text-green-800"
                                    : "bg-red-100 text-red-800"
                                }`}>
                                {status}
                              </span>
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {row.presentAt
                                ? new Date(row.presentAt).toLocaleString()
                                : "—"}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-col gap-2 min-w-[240px]">
                                {!row.present && (
                                  <Button
                                    onClick={() =>
                                      openRemarkDialog({
                                        kind: "mark_present",
                                        userId: row.userId,
                                      })
                                    }
                                    disabled={isAssigning || isPastSelectedDate}
                                    variant="outline">
                                    {isAssigning ? "Saving..." : "Mark Present"}
                                  </Button>
                                )}
                                <select
                                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                  value={assignedValue}
                                  onChange={(e) =>
                                    setTeamLeadPendingDelegateByUserId(
                                      (prev) => ({
                                        ...prev,
                                        [row.userId]: e.target.value,
                                      }),
                                    )
                                  }
                                  disabled={
                                    row.present ||
                                    isAssigning ||
                                    isPastSelectedDate
                                  }>
                                  <option value="">No delegate</option>
                                  {teamLeadDelegateOptions
                                    .filter((d) => d.userId !== row.userId)
                                    .map((d) => (
                                      <option key={d.userId} value={d.userId}>
                                        {d.userName}
                                      </option>
                                    ))}
                                </select>
                                <Button
                                  onClick={() =>
                                    openRemarkDialog({
                                      kind: "assign_team_lead",
                                      userId: row.userId,
                                    })
                                  }
                                  disabled={
                                    row.present ||
                                    isAssigning ||
                                    isPastSelectedDate
                                  }
                                  variant="outline">
                                  {isAssigning
                                    ? "Assigning..."
                                    : "Save Assignment"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {user.role === "admin" && teamLeadDelegateOptions.length > 0 && (
            <div className="mb-4 max-w-sm">
              <Label htmlFor="team-lead-select">Select Team</Label>
              <select
                id="team-lead-select"
                className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={selectedTeamLeadId}
                onChange={(e) => setSelectedTeamLeadId(e.target.value)}>
                {teamLeadDelegateOptions.map((tl) => (
                  <option key={tl.userId} value={tl.userId}>
                    {tl.userName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!teamLoading && !error && flagSummary && (
            <div className="mb-4 text-sm text-muted-foreground">
              Flagged (Week {flagSummary.week.startDateKey} →{" "}
              {flagSummary.week.endDateKey}): {flagSummary.week.flaggedCount} ·
              Flagged (Month {flagSummary.month.startDateKey} →{" "}
              {flagSummary.month.endDateKey}): {flagSummary.month.flaggedCount}
            </div>
          )}

          {teamLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <div className="p-3 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
              {error}
            </div>
          ) : !teamAttendance || teamAttendance.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Agent</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Present At</th>
                    <th className="text-left p-3">Assign</th>
                    <th className="text-left p-3">Linkedin IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {teamAttendance.rows.map((row) => {
                    const status = row.present
                      ? row.presentWithDelegateFlag
                        ? "Present (Flagged)"
                        : "Present"
                      : "Absent";
                    const assignedValue =
                      pendingDelegateByAbsentUserId[row.userId] ?? "";
                    const isAssigning = isAssigningForUserId === row.userId;

                    return (
                      <tr key={row.userId} className="border-b">
                        <td className="p-3">{row.userName}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs ${
                              row.present
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}>
                            {status}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {row.presentAt
                            ? new Date(row.presentAt).toLocaleString()
                            : "—"}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-2 min-w-[240px]">
                            {!row.present && (
                              <Button
                                onClick={() =>
                                  openRemarkDialog({
                                    kind: "mark_present",
                                    userId: row.userId,
                                  })
                                }
                                disabled={isAssigning || isPastSelectedDate}
                                variant="outline">
                                {isAssigning ? "Saving..." : "Mark Present"}
                              </Button>
                            )}
                            <select
                              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              value={assignedValue}
                              onChange={(e) =>
                                setPendingDelegateByAbsentUserId((prev) => ({
                                  ...prev,
                                  [row.userId]: e.target.value,
                                }))
                              }
                              disabled={
                                row.present || isAssigning || isPastSelectedDate
                              }>
                              <option value="">No delegate</option>
                              {teamAttendance.delegateOptions
                                .filter((d) => d.userId !== row.userId)
                                .map((d) => (
                                  <option key={d.userId} value={d.userId}>
                                    {d.userName}
                                  </option>
                                ))}
                            </select>
                            <Button
                              onClick={() =>
                                openRemarkDialog({
                                  kind: "assign_agent",
                                  userId: row.userId,
                                })
                              }
                              disabled={
                                row.present || isAssigning || isPastSelectedDate
                              }
                              variant="outline">
                              {isAssigning ? "Assigning..." : "Save Assignment"}
                            </Button>
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {row.linkedinAccounts.length === 0
                            ? "—"
                            : row.linkedinAccounts
                                .map((a) => `${a.company}: ${a.idName}`)
                                .join(", ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {remarkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-background border shadow-lg">
            <div className="p-4 border-b">
              <div className="text-lg font-semibold">Remark</div>
              <div className="text-sm text-muted-foreground">
                This is required for any update.
              </div>
            </div>
            <div className="p-4 space-y-2">
              <Label htmlFor="attendance-remark">Remark</Label>
              <textarea
                id="attendance-remark"
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                className="w-full min-h-[120px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Type remark..."
              />
            </div>
            <div className="p-4 border-t flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRemarkDialog(null);
                  setRemarkText("");
                }}
                disabled={isAssigningForUserId === remarkDialog.userId}>
                Cancel
              </Button>
              <Button
                onClick={submitRemarkDialog}
                disabled={isAssigningForUserId === remarkDialog.userId}>
                {isAssigningForUserId === remarkDialog.userId
                  ? "Saving..."
                  : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
