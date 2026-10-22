'use client';
import { useEffect, useState } from 'react';
import { replaceDocument } from '@/lib/utils/document-navigation';
export function VerifiedLoginRedirect({ target, onSignOut }: { target: string; onSignOut: () => Promise<void> }) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    const recovery = window.setTimeout(() => setDelayed(true), 8000);
    try { replaceDocument(target); } catch { setDelayed(true); }
    return () => window.clearTimeout(recovery);
  }, [target]);
  if (!delayed) return <main className="min-h-screen flex items-center justify-center" role="status" aria-label="Opening dashboard">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
  </main>;
  return <main className="min-h-screen flex flex-col items-center justify-center gap-5 p-6">
    <h1 className="text-xl font-semibold" role="status">Navigation is taking longer than expected</h1>
    <p>Your sign-in has been verified. You can retry opening your dashboard.</p>
    <a className="underline" href={target}>Open dashboard</a>
    <button className="underline" onClick={() => void onSignOut()}>Sign out</button>
  </main>;
}
