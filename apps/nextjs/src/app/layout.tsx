import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SessionProvider } from "next-auth/react";

import { cn } from "@acme/ui";
import { ThemeProvider } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import { env } from "~/env";

import "~/app/globals.css";

import { TooltipProvider } from "@acme/ui/tooltip";

import { GoogleAnalytics } from "~/app/_components/google-analytics";
import { UserLocationProvider } from "~/app/_components/map/user-location-provider";
import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
import { ShadCnContainer } from "~/app/_components/shad-cn-container-ref";
import { OrpcReactProvider } from "~/orpc/react";
import { KeyPressProvider } from "~/utils/key-press/provider";
import { RouteChangeTracker } from "./_components/route-change-tracker";

import "../orpc/client.server"; // for pre-rendering

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production"
      ? "https://maps.f3nation.com"
      : "http://localhost:3000",
  ),
  title: "F3 Nation Map",
  description: "Find F3 locations near you",
  openGraph: {
    title: "F3 Nation Map",
    description: "Find F3 locations near you",
    url: "https://maps.f3nation.com",
    siteName: "F3 Nation Map",
  },
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
          "min-h-dvh w-screen overflow-hidden bg-background font-sans text-foreground antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <GoogleAnalytics />
        <RouteChangeTracker />
        <DataProvider>
          <ElementProvider>{props.children}</ElementProvider>
        </DataProvider>
      </body>
    </html>
  );
}
const DataProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <SessionProvider>
      <OrpcReactProvider>
        <UserLocationProvider>
          <KeyPressProvider>{children}</KeyPressProvider>
        </UserLocationProvider>
      </OrpcReactProvider>
    </SessionProvider>
  );
};

const ElementProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider delayDuration={100}>{children}</TooltipProvider>
      <Toaster />
      <ShadCnContainer />
      <ModalSwitcher />
    </ThemeProvider>
  );
};
