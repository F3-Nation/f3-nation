"use client";

import { useEffect } from "react";

import { captureException } from "@acme/observability/browser";
import { ErrorScreen } from "@acme/ui/status-screen";

export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // Server Component errors carry a digest and were already logged
    // server-side by onRequestError in instrumentation.ts.
    if (error instanceof Error && "digest" in error) return;
    captureException(error);
  }, [error]);

  return <ErrorScreen error={error} onRetry={retry} />;
}
