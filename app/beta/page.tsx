'use client';

import { ProtectedRoute } from '@/components/protected-route';
import { Card, CardContent } from '@/components/ui/card';

export default function BetaPage() {
  return (
    <ProtectedRoute componentKey="beta">
      <div className="container mx-auto max-w-5xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Beta</h1>
        <Card>
          <CardContent className="py-8">
            <p className="text-muted-foreground">No new features are currently in beta.</p>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
