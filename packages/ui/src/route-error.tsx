"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "./button";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /**
   * Called once per distinct `error` instance, before render. This runs in
   * the browser, so wire it to a browser-safe reporter only - `console.error`,
   * or `Sentry.captureException` where the app has Sentry's client SDK
   * configured. Never the `@acme/logger` (pino) helpers: pino depends on
   * `node:module` and other Node builtins that don't exist in a client
   * bundle, and pulling it in here breaks the build (see #620).
   */
  onError?: (error: Error & { digest?: string }) => void;
}

/**
 * Shared body for every app's root `error.tsx`. Renders the same styled
 * boundary everywhere so a thrown error in a server component doesn't fall
 * through to Next's unstyled default screen.
 */
export function RouteError({ error, reset, onError }: RouteErrorProps) {
  // Every caller passes an inline `onError`, a fresh closure on each render.
  // Keeping it out of the effect's deps (via a ref) is what makes "once per
  // distinct error" above true - depending on it directly would re-run the
  // effect, and re-report the same error, on any unrelated parent rerender.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          We hit an unexpected error loading this page. Trying again usually
          fixes it.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
