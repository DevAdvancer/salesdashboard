'use client';

import { ProtectedRoute } from '@/components/protected-route';
import { LinkedinBetaManagement } from '@/components/linkedin-beta-management';

export default function BetaPage() {
  return <ProtectedRoute componentKey="beta">
    <div className="container mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beta</h1>
      <LinkedinBetaManagement />
    </div>
  </ProtectedRoute>;
}
