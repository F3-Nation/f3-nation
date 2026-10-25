"use client";

import { useEffect } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { captureException } from "@acme/observability/browser";
import { cn } from "@acme/ui";
import { ErrorScreen } from "@acme/ui/status-screen";

import "~/app/globals.css";

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
    captureException(error);
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
        <ErrorScreen error={error} onRetry={retry} className="min-h-dvh" />
      </body>
    </html>
  );
}
