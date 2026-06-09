"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/lib/constants/support";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[var(--background)] px-4 py-12">
      <section className="w-full max-w-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--soft-cloud)] text-[var(--foreground)]">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-medium text-[var(--foreground)]">
          Something didn&apos;t load correctly
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          Please try again. If this keeps happening, contact support and include
          the error reference shown below.
        </p>
        {error.digest ? (
          <p className="mt-4 rounded-md border border-[var(--border)] bg-[var(--soft-cloud)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            Reference: <span className="font-mono text-[var(--foreground)]">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={reset} className="sm:flex-1">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}`;
            }}
            className="sm:flex-1"
          >
            Contact support
          </Button>
        </div>
      </section>
    </main>
  );
}
