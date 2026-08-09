export async function setup() {
  process.env.NODE_ENV = "test";
  process.env.SKIP_ENV_VALIDATION = "1";

  // NODE_ENV must be set before we dynamically import @acme/db/testing.
  // Static imports are hoisted, which would cause @acme/db to load under
  // development settings (and target DATABASE_URL instead of TEST_DATABASE_URL).
  const { resetTestDb } = await import("@acme/db/testing");
  await resetTestDb({ shouldReset: true, shouldSeed: true, seedType: "test" });
}
