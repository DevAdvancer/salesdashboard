import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/auth-context";
import { AccessControlProvider } from "@/lib/contexts/access-control-context";
import { AzureMsalProvider } from "@/components/azure-msal-provider";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/app-layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { QueryProvider } from "@/app/providers/query-provider";
import { NotificationProvider } from "@/lib/providers/notification-provider";

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SalesHub CRM | Silverspace Inc.",
  description: "Manager-controlled customer relationship management system by Silverspace Inc.",
  icons: {
    icon: "/silverspace.png",
    apple: "/silverspace.png",
  },
};

const themeBootScript = `
(() => {
  try {
    const savedTheme = localStorage.getItem('salesdashboard-theme') || 'light';
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    document.documentElement.style.colorScheme = savedTheme === 'dark' ? 'dark' : 'light';
  } catch {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body
        className={`${inter.variable} ${bebasNeue.variable} antialiased`}
      >
        <AzureMsalProvider>
          <ErrorBoundary>
            <AuthProvider>
              <QueryProvider>
                <AccessControlProvider>
                  <NotificationProvider>
                    <AppLayout>{children}</AppLayout>
                    <Toaster />
                  </NotificationProvider>
                </AccessControlProvider>
              </QueryProvider>
            </AuthProvider>
          </ErrorBoundary>
        </AzureMsalProvider>
      </body>
    </html>
  );
}
