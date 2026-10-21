"use client";

import { ErrorScreen } from "@acme/ui/status-screen";

import "./globals.css";

// Replaces the root layout when it throws, so it renders its own document
// and imports the global styles itself.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background font-sans text-foreground antialiased">
        <ErrorScreen error={error} onRetry={retry} className="min-h-dvh" />
      </body>
    </html>
  );
}
