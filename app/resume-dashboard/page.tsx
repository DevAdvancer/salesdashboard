"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProtectedRoute } from "@/components/protected-route";
import { Button } from "@/components/ui/button";
import { appIcons } from "@/components/navigation-config";
import { Users, Clock, TrendingUp, FileText } from "lucide-react";

function ResumeDashboardContent() {
  const { user, isAdmin, isMonitor, isOperations, activeDashboard } = useAuth();
  const router = useRouter();

  // Belt-and-suspenders guard: ProtectedRoute gates by componentKey, but a
  // sales-only user (someone who can't switch dashboards and isn't in
  // leadership) must not see this page even if canAccess ever drifts.
  // Admin / Monitor / Operations are intentionally allowed — they oversee
  // both teams and can preview either dashboard from a single login.
  const canBeOnResumeView = isAdmin || isMonitor || isOperations || activeDashboard === "resume";

  if (user && !canBeOnResumeView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            You don&apos;t have access to this dashboard. Returning you to the
            sales dashboard…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => router.replace("/dashboard")}
          >
            Go to Sales Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!user) return null;

  const ResumeIcon = appIcons.resumeDashboard ?? FileText;
  const TeamIcon = Users;
  const InProgressIcon = Clock;
  const WeeklyIcon = TrendingUp;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Resume Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {user.name}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resumes Reviewed</CardTitle>
            <ResumeIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <InProgressIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <TeamIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground mt-1">Resume team</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <WeeklyIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user.name}!</CardTitle>
          <CardDescription>
            You are logged in as a {user.role.replace(/_/g, " ")} on the Resume team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Email:</strong> {user.email}
          </p>
          <p>
            <strong>Role:</strong> {user.role.replace(/_/g, " ")}
          </p>
          <p>
            <strong>Department:</strong> {user.department}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResumeDashboardPage() {
  return (
    <ProtectedRoute componentKey="resume-dashboard">
      <ResumeDashboardContent />
    </ProtectedRoute>
  );
}