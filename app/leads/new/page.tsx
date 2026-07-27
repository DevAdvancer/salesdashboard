"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { LeadGenerationNewLeadContent } from "@/components/leads/new/lead-generation-new-lead";
import { LegacyNewLeadContent } from "@/components/leads/new/legacy-new-lead";

export default function NewLeadPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <NewLeadContent />
    </ProtectedRoute>
  );
}

function NewLeadContent() {
  const { user } = useAuth();

  if (user?.role === "lead_generation") {
    return <LeadGenerationNewLeadContent />;
  }

  return <LegacyNewLeadContent />;
}
