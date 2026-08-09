export async function setup() {
  // Load-bearing ordering: getDbUrl() reads isTest (packages/shared/src/common/constants.ts),
  // which evaluates process.env.NODE_ENV === "test" at module load. ESM hoists static imports
  // above statements, so a top-level `import { resetTestDb } from "@acme/db/testing"` would
  // resolve the DB module graph before NODE_ENV is set here and reset DATABASE_URL instead of
  // TEST_DATABASE_URL. The dynamic import defers that resolution until after these assignments.
  //
  // Object.assign, not direct assignment: `next`'s peer-dependency types declare
  // NODE_ENV readonly on NodeJS.ProcessEnv, and that ambient declaration applies
  // program-wide once anything in this package references Next's types.
  Object.assign(process.env, { NODE_ENV: "test", SKIP_ENV_VALIDATION: "1" });

  const { resetTestDb } = await import("@acme/db/testing");
  await resetTestDb({ shouldReset: true, shouldSeed: true, seedType: "test" });
}
