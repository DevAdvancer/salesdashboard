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
  const [pendingMarkPresent, setPendingMarkPresent] = useState<Set<string>>(new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);

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
  const isAdminLikeAttendance =
    user?.role === "admin" || user?.role === "developer" || user?.role === "monitor";
  const canEditAttendance = user?.role === "admin" || user?.role === "team_lead";

  const loadOverview = useCallback(async () => {
    if (!user) return;
    if (isAdminLikeAttendance) {
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
      } else if (isAdminLikeAttendance) {
        if (user.role === "admin") {
          void checkAndNotifyAdminAttendanceEscalationsAction({
            currentUserId: user.$id,
          }).catch(() => {});
        }
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
      if (isAdminLikeAttendance) {
        setOverviewLoading(false);
      } else {
        setTeamLoading(false);
      }
    }
  }, [isAdminLikeAttendance, selectedDateKey, user]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadTeamAttendanceOnly = useCallback(async () => {
    if (!user) return;

    if (user.role === "team_lead") {
      await loadOverview();
      return;
    }

    if (!isAdminLikeAttendance) {
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
  }, [isAdminLikeAttendance, loadOverview, selectedDateKey, selectedTeamLeadId, user]);

  const getModifiedActions = useCallback((target: "team_leads" | "team_attendance" | "all" = "all") => {
    const actions: {
      kind: "mark_present" | "assign";
      userId: string;
      delegateUserId: string | null;
      isTeamLeadTarget: boolean;
    }[] = [];

    if (target === "team_leads" || target === "all") {
      teamLeadRows.forEach((row) => {
        if (row.present) return;
        if (pendingMarkPresent.has(row.userId)) {
          actions.push({
            kind: "mark_present",
            userId: row.userId,
            delegateUserId: null,
            isTeamLeadTarget: true,
          });
        } else {
          const currentAssign = teamLeadPendingDelegateByUserId[row.userId] || "";
          const originalAssign = row.delegateUserId || "";
          if (currentAssign !== originalAssign) {
            actions.push({
              kind: "assign",
              userId: row.userId,
              delegateUserId: currentAssign ? currentAssign : null,
              isTeamLeadTarget: true,
            });
          }
        }
      });
    }

    if (target === "team_attendance" || target === "all") {
      teamAttendance?.rows.forEach((row) => {
        if (row.present) return;
        if (pendingMarkPresent.has(row.userId)) {
          actions.push({
            kind: "mark_present",
            userId: row.userId,
            delegateUserId: null,
            isTeamLeadTarget: false,
          });
        } else {
          const currentAssign = pendingDelegateByAbsentUserId[row.userId] || "";
          const originalAssign = row.delegateUserId || "";
          if (currentAssign !== originalAssign) {
            actions.push({
              kind: "assign",
              userId: row.userId,
              delegateUserId: currentAssign ? currentAssign : null,
              isTeamLeadTarget: false,
            });
          }
        }
      });
    }

    return actions;
  }, [
    pendingMarkPresent,
    teamLeadRows,
    teamLeadPendingDelegateByUserId,
    teamAttendance,
    pendingDelegateByAbsentUserId,
  ]);

  useEffect(() => {
    if (!user) return;
    if (!isAdminLikeAttendance) return;
    if (!selectedTeamLeadId) return;
    void loadTeamAttendanceOnly();
  }, [isAdminLikeAttendance, loadTeamAttendanceOnly, selectedTeamLeadId, user]);

  const [remarkDialog, setRemarkDialog] = useState<null | {
    bulkActions: ReturnType<typeof getModifiedActions>;
    target: "team_leads" | "team_attendance" | "all";
  }>(null);

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

    setIsSavingAll(true);
    try {
      const promises = remarkDialog.bulkActions.map((action) => {
        if (action.kind === "mark_present") {
          return markAttendancePresentByTeamLeadAction({
            currentUserId: user.$id,
            userId: action.userId,
            dateKey: selectedDateKey || undefined,
            remark,
          });
        } else {
          return assignAttendanceDelegateAction({
            currentUserId: user.$id,
            absentUserId: action.userId,
            delegateUserId: action.delegateUserId,
            dateKey: selectedDateKey || undefined,
            remark,
          });
        }
      });
      await Promise.all(promises);
      toast({
        title: "Success",
        description: "All changes saved successfully.",
      });
      setRemarkDialog(null);
      setRemarkText("");
      setPendingMarkPresent((prev) => {
        const next = new Set(prev);
        remarkDialog.bulkActions.forEach((action) => {
          if (action.kind === "mark_present") {
            next.delete(action.userId);
          }
        });
        return next;
      });

      if (isAdminLikeAttendance) {
        const { target } = remarkDialog;
        if (target === "team_leads" || target === "all") {
          await loadOverview();
        }
        if ((target === "team_attendance" || target === "all") && selectedTeamLeadId) {
          await loadTeamAttendanceOnly();
        }
      } else {
        await loadOverview();
      }
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to save some changes",
        variant: "destructive",
      });
    } finally {
      setIsSavingAll(false);
    }
  };

  if (!user) return null;

  return (
    <div className="container mx-auto pb-24">
      <div className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Attendance</h1>
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between w-full">
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <p className="text-muted-foreground text-sm">Date (ET): {dateKey || "—"}</p>
            <div className="w-full sm:w-64 flex flex-col gap-1">
              <Label htmlFor="attendance-date" className="sr-only">Select Date</Label>
              <DatePicker
                id="attendance-date"
                value={selectedDateKey}
                onChange={setSelectedDateKey}
                maxDate={todayKey}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={loadTeamAttendanceOnly}
              disabled={
                teamLoading || (isAdminLikeAttendance && !selectedTeamLeadId)
              }>
              {teamLoading ? "Refreshing..." : "Refresh"}
            </Button>
            {isAdminLikeAttendance ? (
              <>
                {canEditAttendance && (
                  <>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={isSavingAll || isPastSelectedDate}
                      onClick={() => {
                        const actions = getModifiedActions("team_leads");
                        if (actions.length === 0) {
                          toast({
                            title: "No modifications",
                            description: "There are no changes to save for Team Leads.",
                          });
                          return;
                        }
                        setRemarkDialog({ bulkActions: actions, target: "team_leads" });
                      }}>
                      {isSavingAll ? "Saving..." : "Save Team Leads"}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={isSavingAll || isPastSelectedDate}
                      onClick={() => {
                        const actions = getModifiedActions("team_attendance");
                        if (actions.length === 0) {
                          toast({
                            title: "No modifications",
                            description: "There are no changes to save for Team Attendance.",
                          });
                          return;
                        }
                        setRemarkDialog({ bulkActions: actions, target: "team_attendance" });
                      }}>
                      {isSavingAll ? "Saving..." : "Save Team Attendance"}
                    </Button>
                  </>
                )}
              </>
            ) : (
              !teamLoading && (
                <Button
                  className="w-full sm:w-auto"
                  disabled={isSavingAll || isPastSelectedDate}
                  onClick={() => {
                    const actions = getModifiedActions("all");
                    if (actions.length === 0) {
                      toast({
                        title: "No modifications",
                        description: "There are no changes to save.",
                      });
                      return;
                    }
                    setRemarkDialog({ bulkActions: actions, target: "all" });
                  }}>
                  {isSavingAll ? "Saving..." : "Save All Changes"}
                </Button>
              )
            )}
          </div>
        </div>
      </div>

      {isAdminLikeAttendance && (
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
                                  <label className="flex items-center gap-2 text-sm cursor-pointer border p-2 rounded-md hover:bg-muted/50 transition-colors w-fit">
                                    <input
                                      type="checkbox"
                                      className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                                      checked={pendingMarkPresent.has(row.userId)}
                                      onChange={(e) => {
                                        setPendingMarkPresent((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(row.userId);
                                          else next.delete(row.userId);
                                          return next;
                                        });
                                      }}
                                      disabled={!canEditAttendance || isPastSelectedDate}
                                    />
                                    Mark Present
                                  </label>
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
                                    !canEditAttendance ||
                                    isPastSelectedDate ||
                                    pendingMarkPresent.has(row.userId)
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
          {isAdminLikeAttendance && teamLeadDelegateOptions.length > 0 && (
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
                              <label className="flex items-center gap-2 text-sm cursor-pointer border p-2 rounded-md hover:bg-muted/50 transition-colors w-fit">
                                <input
                                  type="checkbox"
                                  className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                                  checked={pendingMarkPresent.has(row.userId)}
                                  onChange={(e) => {
                                    setPendingMarkPresent((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(row.userId);
                                      else next.delete(row.userId);
                                      return next;
                                    });
                                  }}
                                  disabled={!canEditAttendance || isPastSelectedDate}
                                />
                                Mark Present
                              </label>
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
                                row.present ||
                                !canEditAttendance ||
                                isPastSelectedDate ||
                                pendingMarkPresent.has(row.userId)
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
                disabled={isSavingAll}>
                Cancel
              </Button>
              <Button
                onClick={submitRemarkDialog}
                disabled={isSavingAll}>
                {isSavingAll ? "Saving..." : "Save All"}
              </Button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
