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
  }
};
