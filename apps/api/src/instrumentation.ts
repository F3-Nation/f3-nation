import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerObservability, registerLoggerErrorReporter } =
      await import("@acme/observability");
    const { env } = await import("~/env");
    registerObservability({
      serviceName: "api",
      environment: env.NEXT_PUBLIC_CHANNEL,
      posthog: { apiKey: env.NEXT_PUBLIC_POSTHOG_KEY },
    });
    registerLoggerErrorReporter();
  }
}

// Report uncaught server-side request errors through the OTel exception
// pipeline (PostHog error tracking today — see @acme/observability).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureException } = await import("@acme/observability");
    await captureException(err, {
      // Report the STATIC route template (e.g. "/v1/request/id/[id]"), never
      // the resolved request path — the resolved path can carry ids, tokens,
      // query strings, or PII. The route template is low-cardinality and safe.
      route: context.routePath,
      routerKind: context.routerKind,
      method: request.method,
    });
  } else {
    // The edge runtime can't run the Node observability pipeline (the
    // PostHog adapter needs Node APIs), so errors there — notably proxy.ts's
    // admin-route JWT auth chain, which always runs on the edge — would
    // otherwise vanish with zero signal. At minimum, log the drop so it's a
    // known, monitored gap instead of a silent one.
    console.error("instrumentation.request_error_uncaptured", {
      runtime: process.env.NEXT_RUNTIME,
      route: context.routePath,
    });
  }
};
