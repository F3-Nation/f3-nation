/* eslint-disable jsx-a11y/html-has-lang */
"use client";

import { useEffect } from "react";
import NextError from "next/error";
import posthog from "posthog-js";

import { env } from "~/env";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Gate on the env flag (the same stable signal instrumentation-client.ts
    // uses to decide whether to init), not posthog.__loaded — that's an
    // internal SDK flag, not a documented readiness contract, and can be
    // false/undefined during early app startup, dropping early error reports.
    if (env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.captureException(error);
    }
  }, [error]);

  return (
    <html>
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
