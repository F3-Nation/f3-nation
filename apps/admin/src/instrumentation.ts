import type { Instrumentation } from "next";

// Log uncaught server-side request errors through the app logger. The digest
// matches the Reference shown on the error screen. Report the route template,
// never the resolved path, which can carry ids or tokens.
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("~/lib/logging");
  const digest =
    err instanceof Error && "digest" in err ? String(err.digest) : undefined;
  logError(
    "admin.request.unhandled_error",
    {
      digest,
      route: context.routePath,
      routerKind: context.routerKind,
      method: request.method,
    },
    err,
  );
};
