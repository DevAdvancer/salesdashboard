"use client";

import { ProtectedRoute } from "@/components/protected-route";
import { TargetReportDashboard } from "@/components/target-report/target-report-dashboard";
import { useAuth } from "@/lib/contexts/auth-context";

export default function TargetReportPage() {
  return (
    <ProtectedRoute componentKey="target-report">
      <TargetReportContent />
    </ProtectedRoute>
  );
}

function TargetReportContent() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Target Report</h1>
        <p className="text-muted-foreground">
          Compare team targets against actual collections per month. Admins set
          the team total; team leads split it across their agents.
        </p>
      </div>
      <TargetReportDashboard user={user} />
    </div>
  );
}
