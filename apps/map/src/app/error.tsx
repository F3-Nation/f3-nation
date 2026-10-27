"use client";

import { useEffect } from "react";

import { ErrorScreen } from "@acme/ui/status-screen";

import { reportClientError } from "~/lib/report-client-error";

export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // Server Component errors carry a digest and were already captured with
    // their full stack by onRequestError in instrumentation.ts.
    if (error instanceof Error && "digest" in error) return;
    reportClientError(error);
  }, [error]);

  return <ErrorScreen error={error} onRetry={retry} className="h-dvh" />;
}
