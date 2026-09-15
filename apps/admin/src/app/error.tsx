"use client";

import { RouteError } from "@acme/ui/route-error";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} onError={(error) => console.error(error)} />;
}
