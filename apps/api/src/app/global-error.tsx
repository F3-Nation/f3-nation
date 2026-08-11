"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import { env } from "~/env";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Gate on the env flag (the same stable signal instrumentation-client.ts
    // uses to decide whether to init), not posthog.__loaded — that's an
    // internal SDK flag, not a documented readiness contract, and can be
    // false/undefined during early app startup, dropping early error reports.
    if (env.NEXT_PUBLIC_POSTHOG_KEY) {
      // This is the last-resort fallback UI — no error boundary above it. If
      // captureException itself throws (e.g. the ingest host is blocked by
      // an ad-blocker/privacy list), the throw must not be allowed to bubble
      // out here with nowhere left to go.
      try {
        posthog.captureException(error);
      } catch (reportErr) {
        console.error("posthog.capture_exception_failed", reportErr);
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong.</h2>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
