"use client";

import posthog from "posthog-js";

import { RouteError } from "@acme/ui/route-error";

import { env } from "~/env";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      onError={(error) => {
        // Same gate as global-error.tsx: report only when PostHog is configured.
        if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
        // Only server-originated errors carry a digest. Those are already
        // reported with full context by `onRequestError` in instrumentation.ts;
        // the client copy would only hold Next's redacted message.
        if (error.digest) return;
        try {
          posthog.captureException(error);
        } catch {
          // A blocked ingest host must not throw out of the error boundary
          // itself. React already logs the caught error to the console, and
          // docs/OBSERVABILITY_PLAN.md §6 keeps its list of console.* sites
          // exhaustive, so this boundary adds none.
        }
      }}
    />
  );
}
