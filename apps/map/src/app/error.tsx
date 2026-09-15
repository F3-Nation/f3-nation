"use client";

import * as Sentry from "@sentry/nextjs";

import { RouteError } from "@acme/ui/route-error";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      onError={(error) => Sentry.captureException(error)}
    />
  );
}
