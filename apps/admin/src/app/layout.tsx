import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";

import { cn } from "@acme/ui";
import { ThemeProvider } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";
import { TooltipProvider } from "@acme/ui/tooltip";

import "~/app/globals.css";

import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
import { env } from "~/env";
import { AdminSessionProvider } from "~/lib/auth/client";
import { getSessionUser, requireAdminPortalAccess } from "~/lib/auth/server";
import { OrpcReactProvider } from "~/orpc/react";

export const metadata: Metadata = {
  title: "F3 Nation Admin",
  description: "F3 Nation Admin Portal",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const protectedPathname = requestHeaders.get("x-admin-pathname");
  const initialSession = await getSessionUser();
  const runtimeConfig = {
    googleApiKey: env.F3_GOOGLE_API_KEY,
    isProd: env.F3_CHANNEL === "prod",
  };

  if (protectedPathname) {
    await requireAdminPortalAccess(initialSession);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-dvh bg-background font-sans text-foreground antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <AdminSessionProvider initialSession={initialSession}>
          <OrpcReactProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="light"
              enableSystem={false}
            >
              <TooltipProvider delayDuration={100}>
                {props.children}
              </TooltipProvider>
              <Toaster />
              <ModalSwitcher runtimeConfig={runtimeConfig} />
            </ThemeProvider>
          </OrpcReactProvider>
        </AdminSessionProvider>
      </body>
    </html>
  );
}
