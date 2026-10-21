'use client';

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';

export default function MaintenancePage() {
  const [endsAt, setEndsAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/maintenance/status', { cache: 'no-store' });
        if (!response.ok) return;
        const status = await response.json() as { active: boolean; endsAt: string | null };
        if (!alive) return;
        setEndsAt(status.endsAt);
        if (!status.active) window.location.replace('/login');
      } catch { /* Keep the scheduled message visible during transient errors. */ }
    };
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <Wrench className="mx-auto mb-5 h-9 w-9 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">CRM maintenance in progress</h1>
        <p className="mt-3 text-muted-foreground">Access to this site is paused while we work on the CRM. Please try again after the scheduled time.</p>
        {endsAt && (
          <p className="mt-5 rounded-lg bg-muted px-4 py-3 font-medium">
            Expected to finish {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(endsAt))} ET
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">This page will return to sign in when maintenance ends.</p>
      </div>
    </main>
  );
}
