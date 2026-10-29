/**
 * Node-only half of `register()` (see instrumentation.ts). Kept in its own
 * module so the Edge build never sees `process.exit`.
 */
export async function validateEnvOrExit(): Promise<void> {
  try {
    await import("./env");
  } catch (err) {
    const { logFatal } = await import("./lib/logging");
    logFatal("region_pages.startup.invalid_env", {}, err);
    process.exit(1);
  }
}
