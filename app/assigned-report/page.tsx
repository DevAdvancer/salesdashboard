"use client";

import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";
import { getAssignedReportData } from "@/app/actions/assigned-report";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { ChevronDown, ChevronRight, UserCheck, Zap, ShieldAlert, Calendar, Users } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-picker";

export default function AssignedReportPage() {
  return (
    <ProtectedRoute componentKey="assigned-report">
      <AssignedReportContent />
    </ProtectedRoute>
  );
}

function AssignedReportContent() {
  const { user } = useAuth();
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState<string | undefined>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState<string | undefined>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assigned-report', dateFrom, dateTo],
    queryFn: () => getAssignedReportData(user!.$id, dateFrom, dateTo),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Assigned Report</h1>
          <p className="text-muted-foreground">Team lead assignment breakdown</p>
        </div>
        <Card>
          <CardContent className="p-4 md:p-6">
            <TableSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto space-y-6">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>Failed to load assigned report.</p>
            <Button onClick={() => refetch()} className="mt-4">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summaries = data || [];
  
  const totalLeads = summaries.reduce((acc, team) => acc + team.totalLeads, 0);
  const totalAdmin = summaries.reduce((acc, team) => acc + team.byAdmin, 0);
  const totalLeadGen = summaries.reduce((acc, team) => acc + team.byLeadGen, 0);
  const totalClosed = summaries.reduce((acc, team) => acc + team.closedCount, 0);

  const setToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setDateFrom(today);
    setDateTo(today);
  };

  const setThisMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    setDateFrom(firstDay);
    setDateTo(lastDay);
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Assigned Report</h1>
          <p className="text-muted-foreground">
            Track leads assigned by admin or lead generation and their closed counts across teams.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Date Range</span>
            <DateRangePicker 
              value={{ from: dateFrom, to: dateTo }}
              onChange={(range) => {
                setDateFrom(range.from ?? undefined);
                setDateTo(range.to ?? undefined);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={setToday}>Today</Button>
            <Button variant="outline" size="sm" onClick={setThisMonth}>This Month</Button>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground mb-1">Total Leads</div>
            <div className="text-2xl font-bold">{totalLeads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <UserCheck className="h-4 w-4 text-blue-500" /> By Admin
            </div>
            <div className="text-2xl font-bold">{totalAdmin}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Users className="h-4 w-4 text-orange-500" /> By Lead Gen
            </div>
            <div className="text-2xl font-bold">{totalLeadGen}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Zap className="h-4 w-4 text-green-500" /> Closed
            </div>
            <div className="text-2xl font-bold">{totalClosed}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {summaries.map(team => {
          const isExpanded = expandedTeams.has(team.teamLeadId);
          return (
            <Card key={team.teamLeadId}>
              <div 
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleTeam(team.teamLeadId)}
              >
                <div className="flex items-center gap-2 mb-2 sm:mb-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 pointer-events-none">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  <h3 className="font-semibold text-lg">{team.teamLeadName}</h3>
                  <Badge variant="default" className="ml-2">{team.totalLeads} Leads</Badge>
                </div>
                {!isExpanded && (
                  <div className="flex items-center gap-2 text-sm pl-10 sm:pl-0">
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Admin: {team.byAdmin}</Badge>
                    <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">LG: {team.byLeadGen}</Badge>
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Closed: {team.closedCount}</Badge>
                  </div>
                )}
              </div>
              
              {isExpanded && (
                <CardContent className="p-0 border-t">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr className="text-left">
                          <th className="p-3 font-semibold">Name</th>
                          <th className="p-3 font-semibold">Role</th>
                          <th className="p-3 font-semibold">Total Leads</th>
                          <th className="p-3 font-semibold">By Admin</th>
                          <th className="p-3 font-semibold">By Lead Gen</th>
                          <th className="p-3 font-semibold">Closed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.members.map(member => (
                          <tr key={member.userId} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="p-3">{member.userName}</td>
                            <td className="p-3 capitalize">{member.role.replace('_', ' ')}</td>
                            <td className="p-3 font-medium">{member.totalLeads}</td>
                            <td className="p-3 text-blue-600 dark:text-blue-400">{member.byAdmin}</td>
                            <td className="p-3 text-orange-600 dark:text-orange-400">{member.byLeadGen}</td>
                            <td className="p-3 text-green-600 dark:text-green-400">{member.closedCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
        {summaries.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No assignment data found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
