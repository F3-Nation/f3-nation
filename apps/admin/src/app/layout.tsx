import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";
import Image from "next/image";

import { cn } from "@acme/ui";
import { ApiUnavailable } from "@acme/ui/api-unavailable";
import { ThemeProvider } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";
import { TooltipProvider } from "@acme/ui/tooltip";

import "~/app/globals.css";

import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
import { env } from "~/env";
import { AdminSessionProvider } from "~/lib/auth/client";
import { getSessionLookup, requireAdminPortalAccess } from "~/lib/auth/server";
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
  const { session: initialSession, apiUnavailable } = await getSessionLookup();
  const runtimeConfig = {
    googleApiKey: env.F3_GOOGLE_API_KEY,
    isProd: env.F3_CHANNEL === "prod",
  };
  const bodyClassName = cn(
    "min-h-dvh bg-background font-sans text-foreground antialiased",
    GeistSans.variable,
    GeistMono.variable,
  );

  if (protectedPathname) {
    // Roles could not be loaded, so the access check below would wrongly send
    // a real admin to "no access". Say what is actually wrong instead.
    if (apiUnavailable) {
      return (
        <html lang="en">
          <body className={bodyClassName}>
            <main className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
              <ApiUnavailable
                title="Admin is temporarily unavailable"
                message="The F3 Nation API is not responding, so the admin portal cannot load right now."
                logo={
                  <Image src="/f3_logo.png" alt="F3" width={80} height={80} />
                }
              />
            </main>
          </body>
        </html>
      );
    }
    await requireAdminPortalAccess(initialSession);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={bodyClassName}>
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
