"use client";

import { WeeklyReportDashboard } from "@/components/reports/weekly-report-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/contexts/auth-context";

export default function ReportsPage() {
  return (
    <ProtectedRoute componentKey="reports">
      <ReportsContent />
    </ProtectedRoute>
  );
}

function ReportsContent() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Weekly performance metrics for your role scope.
        </p>
      </div>
      <WeeklyReportDashboard user={user} />
    </div>
  );
}
