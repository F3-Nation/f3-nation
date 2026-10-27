"use client";

import { useEffect } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { cn } from "@acme/ui";
import { ErrorScreen } from "@acme/ui/status-screen";

import "~/app/globals.css";

import { reportClientError } from "~/lib/report-client-error";

// Replaces the root layout when it throws, so it renders its own document
// and imports the global styles itself.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        className={cn(
          "bg-background font-sans text-foreground antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <ErrorScreen error={error} onRetry={retry} className="h-dvh" />
      </body>
    </html>
  );
}
