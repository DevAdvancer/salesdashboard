"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { SUPPORT_EMAIL } from "@/lib/constants/support";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif" }}>
        <main
          style={{
            alignItems: "center",
            background: "#ffffff",
            color: "#111111",
            display: "flex",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
          }}
        >
          <section
            style={{
              border: "1px solid #e5e5e5",
              maxWidth: "520px",
              padding: "24px",
              width: "100%",
            }}
          >
            <h1 style={{ fontSize: "24px", fontWeight: 600, margin: "0 0 12px" }}>
              Something didn&apos;t load correctly
            </h1>
            <p style={{ color: "#4b4b4d", lineHeight: 1.6, margin: 0 }}>
              Please refresh the page. If this keeps happening, contact support
              and include the error reference shown below.
            </p>
            {error.digest ? (
              <p
                style={{
                  background: "#f5f5f5",
                  border: "1px solid #e5e5e5",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  margin: "16px 0 0",
                  padding: "10px",
                  wordBreak: "break-all",
                }}
              >
                Reference: {error.digest}
              </p>
            ) : null}
            <p style={{ color: "#4b4b4d", fontSize: "14px", margin: "16px 0 0" }}>
              Support:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#111111" }}>
                {SUPPORT_EMAIL}
              </a>
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
