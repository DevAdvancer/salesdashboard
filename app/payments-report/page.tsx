"use client";

import { PaymentsReportDashboard } from "@/components/payments/payments-report-dashboard";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/contexts/auth-context";

export default function PaymentsReportPage() {
  return (
    <ProtectedRoute componentKey="payments-report">
      <PaymentsReportContent />
    </ProtectedRoute>
  );
}

function PaymentsReportContent() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Payments Report</h1>
        <p className="text-muted-foreground">
          Track client payment status, last update notes, and amounts paid.
        </p>
      </div>
      <PaymentsReportDashboard user={user} />
    </div>
  );
}
