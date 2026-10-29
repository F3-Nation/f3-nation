/**
 * Validate config when the server boots, not on the first request. Cloud Run's
 * default startup probe only checks that the port is open, so a revision with a
 * missing or malformed env var would otherwise go live and serve 500s. Exiting
 * fails the revision instead, and the previous one keeps serving.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnvOrExit } = await import("./instrumentation-node");
  await validateEnvOrExit();
}
