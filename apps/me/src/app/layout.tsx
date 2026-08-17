import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@acme/ui/toast";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Navbar } from "@/components/navbar";
import { SaveProvider } from "@/lib/save-context";
import { GoogleAnalytics } from "@/components/google-analytics";
import { VersionInfo } from "@/components/version-info";
import { ApiDownSplash } from "@/components/api-down-splash";
import { getChangelog } from "@/lib/changelog";
import { isApiDown } from "@/lib/api-health";
import { env } from "@/env";
import packageJson from "../../package.json";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "F3 Me — Profile Manager",
  description:
    "Manage your F3 Nation profile, avatar, emergency contacts, and more.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiDown = await isApiDown(process.env.F3_API_BASE_URL);
  const channel = env.F3_CHANNEL;
  const changelog = getChangelog().slice(0, 10);

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} flex min-h-screen flex-col overflow-x-hidden overscroll-y-none bg-background text-foreground antialiased`}
      >
        {apiDown ? (
          <ApiDownSplash />
        ) : (
          <>
            <GoogleAnalytics />
            <AuthProvider>
              <SaveProvider>
                <Navbar />
                <main className="flex-1">{children}</main>
                <VersionInfo
                  version={packageJson.version}
                  channel={channel}
                  changelog={changelog}
                />
              </SaveProvider>
            </AuthProvider>
          </>
        )}
        <Toaster />
      </body>
    </html>
  );
}
