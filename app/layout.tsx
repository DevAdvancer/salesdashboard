import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/auth-context";
import { AccessControlProvider } from "@/lib/contexts/access-control-context";
import { AzureMsalProvider } from "@/components/azure-msal-provider";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/app-layout";
import { ErrorBoundary } from "@/components/error-boundary";

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SalesHub CRM",
  description: "Manager-controlled customer relationship management system",
  icons: {
    icon: "/silverspace.png",
    apple: "/silverspace.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${playfairDisplay.variable} antialiased`}
      >
        <AzureMsalProvider>
          <ErrorBoundary>
            <AuthProvider>
              <AccessControlProvider>
                <AppLayout>{children}</AppLayout>
                <Toaster />
              </AccessControlProvider>
            </AuthProvider>
          </ErrorBoundary>
        </AzureMsalProvider>
      </body>
    </html>
  );
}
