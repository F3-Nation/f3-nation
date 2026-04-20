import "~/orpc/client.server";

import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SessionProvider } from "next-auth/react";

import { cn } from "@acme/ui";
import { ThemeProvider } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";
import { TooltipProvider } from "@acme/ui/tooltip";

import "~/app/globals.css";

import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
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

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-dvh bg-background font-sans text-foreground antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <SessionProvider>
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
              <ModalSwitcher />
            </ThemeProvider>
          </OrpcReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
