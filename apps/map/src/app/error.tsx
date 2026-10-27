"use client";

import { useEffect } from "react";
import Image from "next/image";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";
import { ApiUnavailable } from "@acme/ui/api-unavailable";
import { ErrorScreen } from "@acme/ui/status-screen";

import { reportClientError } from "~/lib/report-client-error";

export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const apiUnavailable = isApiUnavailableError(error);

  useEffect(() => {
    // Server Component errors carry a digest and were already captured with
    // their full stack by onRequestError in instrumentation.ts.
    if (error instanceof Error && "digest" in error) return;
    // The proxy already logged the outage server-side; every open tab
    // reporting it again on each automatic retry would only add noise.
    if (apiUnavailable) return;
    reportClientError(error);
  }, [error, apiUnavailable]);

  if (apiUnavailable) {
    return (
      <div className="flex h-dvh items-center justify-center p-4">
        <ApiUnavailable
          title="The F3 Nation map is temporarily unavailable"
          message="The F3 Nation API is not responding, so the map cannot load right now."
          logo={
            <Image
              src="/f3_logo.png"
              alt="F3 Nation"
              width={80}
              height={80}
              className="rounded-xl"
            />
          }
        />
      </div>
    );
  }

  return <ErrorScreen error={error} onRetry={retry} className="h-dvh" />;
}
