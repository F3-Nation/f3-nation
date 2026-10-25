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
    // A digest marks a Server Component error, which a static export only
    // hits at build time; report only what the browser threw.
    if (error instanceof Error && "digest" in error) return;
    captureException(error);
  }, [error]);

  return <ErrorScreen error={error} onRetry={retry} />;
}
