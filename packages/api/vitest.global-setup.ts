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
  Object.assign(process.env, { NODE_ENV: "test" });

  // Only SKIP_ENV_VALIDATION is scoped to this call — restored below so it
  // doesn't widen @acme/env's validation skip to the rest of the suite.
  const prevSkipEnvValidation = process.env.SKIP_ENV_VALIDATION;
  Object.assign(process.env, { SKIP_ENV_VALIDATION: "1" });

  const { resetTestDb, createDbClient } = await import("@acme/db/testing");
  const { db, close } = createDbClient();

  try {
    await resetTestDb({
      db,
      shouldReset: true,
      shouldSeed: true,
      seedType: "test",
    });
  } finally {
    // `setup` is a named export, so Vitest's globalSetup contract does not
    // treat its return value as a teardown callback (only a default export's
    // return, or a separately named `teardown` export, would be). This
    // client's lifetime only needs to span the reset itself, so close it
    // here rather than trying to keep it alive for a `teardown` export.
    await close();

    if (prevSkipEnvValidation === undefined) {
      delete process.env.SKIP_ENV_VALIDATION;
    } else {
      Object.assign(process.env, {
        SKIP_ENV_VALIDATION: prevSkipEnvValidation,
      });
    }
  }
}
