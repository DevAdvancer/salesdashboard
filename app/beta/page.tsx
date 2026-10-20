'use client';

import Link from 'next/link';
import { ProtectedRoute } from '@/components/protected-route';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function BetaPage() {
  return <ProtectedRoute componentKey="beta">
    <div className="container mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beta</h1>
      <Card>
        <CardHeader><CardTitle>LinkedIn Helper is available to everyone</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>All eligible LinkedIn Requests users can now use LinkedIn Helper. Individual beta access settings are no longer needed.</p>
          <Link className="underline" href="/linkedin-requests">Open LinkedIn Requests to download LinkedIn Helper</Link>
        </CardContent>
      </Card>
    </div>
  </ProtectedRoute>;
}
