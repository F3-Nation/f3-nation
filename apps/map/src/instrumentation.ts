import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./orpc/client.server");
    const { registerObservability, registerLoggerErrorReporter } =
      await import("@acme/observability");
    const { env } = await import("~/env");
    registerObservability({
      serviceName: "map",
      environment: env.F3_CHANNEL,
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
      // Report the STATIC route template (e.g. "/[locale]/map"), never the
      // resolved request path — the resolved path can carry ids, tokens,
      // query strings, or PII. The route template is low-cardinality and safe.
      route: context.routePath,
      routerKind: context.routerKind,
      method: request.method,
    });
  } else {
    // proxy.ts's matcher is empty today, so this is inert for map right now,
    // but the moment it's populated the same silent-drop gap reappears with
    // no code change needed to trigger it — log the drop so it's a known,
    // monitored gap instead of a silent one.
    console.error("instrumentation.request_error_uncaptured", {
      runtime: process.env.NEXT_RUNTIME,
      route: context.routePath,
    });
  }
};
