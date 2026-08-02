import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerPostHogErrorReporter } = await import("./posthog-server");
    registerPostHogErrorReporter();
  }
}

// Report uncaught server-side request errors to PostHog error tracking.
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureServerException } = await import("./posthog-server");
    await captureServerException(err, {
      // Report the STATIC route template (e.g. "/v1/request/id/[id]"), never
      // the resolved request path — the resolved path can carry ids, tokens,
      // query strings, or PII. The route template is low-cardinality and safe.
      route: context.routePath,
      routerKind: context.routerKind,
      method: request.method,
    });
  } else {
    // The edge runtime can't import posthog-node (it needs Node APIs), so
    // errors there — notably proxy.ts's admin-route JWT auth chain, which
    // always runs on the edge — would otherwise vanish with zero signal. At
    // minimum, log the drop so it's a known, monitored gap instead of a
    // silent one.
    console.error("instrumentation.request_error_uncaptured", {
      runtime: process.env.NEXT_RUNTIME,
      route: context.routePath,
    });
  }
};
