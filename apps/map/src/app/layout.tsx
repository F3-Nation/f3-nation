// https://orpc.dev/docs/best-practices/optimize-ssr
// for pre-rendering
import "~/orpc/client.server";

import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SessionProvider } from "next-auth/react";

import { cn } from "@acme/ui";
import { ThemeProvider } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";
import { headers } from "next/headers";

import { env } from "~/env";

import "~/app/globals.css";

import { TooltipProvider } from "@acme/ui/tooltip";

import { GoogleAnalytics } from "~/app/_components/google-analytics";
import { UserLocationProvider } from "~/app/_components/map/user-location-provider";
import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
import { ShadCnContainer } from "~/app/_components/shad-cn-container-ref";
import { OrpcReactProvider } from "~/orpc/react";
import type { Channel } from "~/utils/runtime-config";
import { RuntimeConfigProvider } from "~/utils/runtime-config";
import { KeyPressProvider } from "~/utils/key-press/provider";
import { RouteChangeTracker } from "./_components/route-change-tracker";

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

export default async function RootLayout(props: { children: React.ReactNode }) {
  await headers();
  const runtimeConfig = {
    apiBaseUrl: process.env.F3_API_BASE_URL,
    adminUrl: process.env.F3_ADMIN_URL,
    mapApiKey: process.env.F3_MAP_API_KEY,
    googleApiKey: process.env.F3_GOOGLE_API_KEY,
    channel: process.env.F3_CHANNEL,
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__F3_RUNTIME__=${JSON.stringify(runtimeConfig)}`,
          }}
        />
      </head>
      <body
        className={cn(
          "min-h-dvh w-screen overflow-hidden bg-background font-sans text-foreground antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <GoogleAnalytics />
        <RouteChangeTracker />
        <DataProvider runtimeConfig={runtimeConfig}>
          <ElementProvider>{props.children}</ElementProvider>
        </DataProvider>
      </body>
    </html>
  );
}
const DataProvider = ({
  runtimeConfig,
  children,
}: {
  runtimeConfig: Record<string, string | undefined>;
  children: React.ReactNode;
}) => {
  return (
    <SessionProvider>
      <RuntimeConfigProvider
        channel={runtimeConfig.channel as Channel}
        googleApiKey={runtimeConfig.googleApiKey ?? ""}
      >
        <OrpcReactProvider>
          <UserLocationProvider>
            <KeyPressProvider>{children}</KeyPressProvider>
          </UserLocationProvider>
        </OrpcReactProvider>
      </RuntimeConfigProvider>
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
