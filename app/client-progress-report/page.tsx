'use client';

import { ClientProgressReport } from '@/components/client-progress/client-progress-report';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/contexts/auth-context';

export default function ClientProgressReportPage() {
  const { user } = useAuth();
  return <ProtectedRoute componentKey="client-progress-report">
    {user && <div className="mx-auto w-full max-w-7xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Client Progress Report</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Feedback activity by client and author</p>
      </header>
      <ClientProgressReport key={user.$id} userId={user.$id} />
    </div>}
  </ProtectedRoute>;
}
