"use client";

import { ErrorScreen } from "@acme/ui/status-screen";

export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <ErrorScreen error={error} onRetry={retry} />;
}
