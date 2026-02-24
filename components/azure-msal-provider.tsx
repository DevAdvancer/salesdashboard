
'use client';

import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "@/lib/msal-config";
import { useEffect, useState } from "react";

export function AzureMsalProvider({ children }: { children: React.ReactNode }) {
  const [msalInstance, setMsalInstance] = useState<PublicClientApplication | null>(null);

  useEffect(() => {
    // Only run on client
    if (typeof window !== 'undefined') {
      const instance = new PublicClientApplication(msalConfig);
      // Initialize MUST be called before using the instance
      instance.initialize().then(() => {
        setMsalInstance(instance);
      }).catch(err => {
        console.error("MSAL Initialization Failed:", err);
      });
    }
  }, []);

  // While initializing, we can render children without provider or a loader
  // But for Auth protected routes, it might be better to wait.
  // For this app, we'll render children directly if not ready to avoid blocking UI
  // The useMsal hook will handle the 'uninitialized' state gracefully if used inside
  if (!msalInstance) {
    return <>{children}</>;
  }

  return (
    <MsalProvider instance={msalInstance}>
      {children}
    </MsalProvider>
  );
}
