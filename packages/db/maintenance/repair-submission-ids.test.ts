// Standalone integration test. Hard-coded disposable localhost target only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(packageRoot, "drizzle");
const repair = fs.readFileSync(
  path.join(packageRoot, "maintenance/repair-submission-ids.sql"),
  "utf8",
);
assert.ok(repair.endsWith("ROLLBACK;\n"));
const commitRepair = repair.replace(/ROLLBACK;\n$/, "COMMIT;\n");
const url = "postgresql://postgres@127.0.0.1:55435/f3_pr825_test";
const db = postgres(url, {
  max: 1,
  onnotice: () => {
    /* Suppress fixture DDL notices. */
  },
});
const second = postgres(url, {
  max: 1,
  onnotice: () => {
    /* Suppress fixture DDL notices. */
  },
});
const pass = (name: string) => process.stdout.write(`PASS: ${name}\n`);

async function fixture() {
  await db.unsafe(
    "DROP SCHEMA IF EXISTS pr825_submission_repair CASCADE; DROP SCHEMA IF EXISTS codex CASCADE",
  );
  await db.unsafe(
    fs.readFileSync(path.join(source, "0027_codex_schema.sql"), "utf8"),
  );
  // 1,562 distinct IDs plus 387 collisions = 1,949 rows. Every collision
  // has different payload/type; 37 have differing status and a pending row.
  await db.unsafe(`INSERT INTO codex.user_submissions
    (id, submission_type, data, submitter_name, submitter_email, status, timestamp, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    SELECT n, 'new', jsonb_build_object('fixture', n, 'version', 1),
      'Synthetic', 'synthetic@example.test', 'approved',
      '2025-01-01'::timestamptz, '2025-01-01'::timestamptz, '2025-02-01'::timestamptz
    FROM generate_series(1,1562) n;
    INSERT INTO codex.user_submissions
    (id, submission_type, data, submitter_name, submitter_email, status, timestamp, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    SELECT n, 'edit', jsonb_build_object('fixture', n, 'version', 2),
      NULL, NULL, CASE WHEN n <= 37 THEN 'pending' ELSE 'approved' END,
      '2025-01-02'::timestamptz, '2025-01-02'::timestamptz, '2025-02-01'::timestamptz
    FROM generate_series(1,387) n;`);
}
async function rows() {
  return db<
    { value: Record<string, unknown> }[]
  >`SELECT to_jsonb(s) AS value FROM codex.user_submissions s ORDER BY id, created_at, data::text`;
}
async function sequence() {
  return db`SELECT last_value::text, is_called FROM codex.user_submissions_id_seq`;
}
async function assertNoRepairArtifacts() {
  assert.equal(
    (
      await db`SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid = 'codex.user_submissions'::regclass AND contype = 'p'`
    )[0]!.n,
    0,
  );
  assert.equal(
    (
      await db`SELECT to_regnamespace('pr825_submission_repair') IS NULL AS absent`
    )[0]!.absent,
    true,
  );
}
async function fail(
  sql: string,
  pattern: RegExp | ((error: unknown) => boolean),
) {
  await assert.rejects(db.unsafe(sql), pattern);
  await db.unsafe("ROLLBACK");
}
async function insert() {
  return db`INSERT INTO codex.user_submissions
    (submission_type, data, status, timestamp, created_at, updated_at)
    VALUES ('new', '{}', 'pending', now(), now(), now()) RETURNING id`;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pr825-repair-"));
  try {
    // Establish the real main migration state before testing the repair upgrade.
    fs.mkdirSync(path.join(temp, "meta"));
    const journal: unknown = JSON.parse(
      fs.readFileSync(path.join(source, "meta/_journal.json"), "utf8"),
    );
    const entries = (
      journal as { entries: { idx: number; tag: string }[] }
    ).entries.filter((e) => e.idx <= 26);
    fs.writeFileSync(
      path.join(temp, "meta/_journal.json"),
      JSON.stringify({ ...(journal as Record<string, unknown>), entries }),
    );
    for (const e of entries)
      fs.copyFileSync(
        path.join(source, `${e.tag}.sql`),
        path.join(temp, `${e.tag}.sql`),
      );
    await migrate(drizzle(db), { migrationsFolder: temp });
    await fixture();
    const original = await rows();
    const seqBefore = await sequence();
    await db.unsafe(repair);
    assert.deepEqual(await rows(), original);
    assert.deepEqual(await sequence(), seqBefore);
    await assertNoRepairArtifacts();
    assert.equal(
      (
        await db`SELECT to_regnamespace('pr825_submission_repair') IS NULL AS absent`
      )[0]!.absent,
      true,
    );
    pass(
      "default rehearsal rolls back rows, mapping schema, primary key and sequence",
    );

    const injected = commitRepair.replace(
      /COMMIT;\n$/,
      () => "DO $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; COMMIT;\n",
    );
    await fail(injected, /injected failure/);
    assert.deepEqual(await rows(), original);
    assert.deepEqual(await sequence(), seqBefore);
    await assertNoRepairArtifacts();
    pass("failure after sequence restart restores original state");

    await db.unsafe(commitRepair);
    const mapping =
      await db`SELECT count(*)::int AS n, count(*) FILTER (WHERE old_id <> new_id)::int AS changed FROM pr825_submission_repair.id_map`;
    assert.deepEqual(mapping[0], { n: 1949, changed: 387 });
    const matched = await db<
      { old_id: number; payload: Record<string, unknown> }[]
    >`SELECT m.old_id, to_jsonb(s) - 'id' AS payload FROM codex.user_submissions s JOIN pr825_submission_repair.id_map m ON m.new_id = s.id`;
    const normalize = (values: unknown[]) =>
      values.map((v) => JSON.stringify(v)).sort();
    assert.deepEqual(
      normalize(matched.map((r) => ({ ...r.payload, id: r.old_id }))),
      normalize(
        original.map((r) => {
          const { id, ...payload } = r.value;
          return { ...payload, id };
        }),
      ),
    );
    assert.equal(
      (
        await db`SELECT count(*)::int AS n FROM codex.user_submissions WHERE id <= 1562 AND submission_type = 'new'`
      )[0]!.n,
      1562,
    );
    assert.equal((await insert())[0]!.id, 1950);
    const modified =
      await db`UPDATE codex.user_submissions SET status = 'rejected' WHERE id = 1 RETURNING id`;
    assert.equal(modified.length, 1);
    assert.equal(
      (await db`SELECT status FROM codex.user_submissions WHERE id = 1563`)[0]!
        .status,
      "pending",
    );
    await assert.rejects(
      db`INSERT INTO codex.user_submissions SELECT * FROM codex.user_submissions WHERE id = 1`,
      /non-DEFAULT value/,
    );
    await assert.rejects(
      db`INSERT INTO codex.user_submissions OVERRIDING SYSTEM VALUE SELECT * FROM codex.user_submissions WHERE id = 1`,
      /duplicate key/,
    );
    await fail(commitRepair, /Existing key/);
    pass(
      "all 1,949 rows preserved; 387 mapped changes; one-row moderation; identity and uniqueness enforced; repeat refused",
    );

    await db`CREATE ROLE synthetic_mapping_reader NOLOGIN NOSUPERUSER NOINHERIT`;
    const [access] = await db`SELECT
      has_schema_privilege('synthetic_mapping_reader', 'pr825_submission_repair', 'USAGE') AS schema_usage,
      has_table_privilege('synthetic_mapping_reader', 'pr825_submission_repair.id_map', 'SELECT') AS table_select`;
    assert.deepEqual(access, { schema_usage: false, table_select: false });
    await assert.rejects(
      db.begin(async (tx) => {
        await tx`SET LOCAL ROLE synthetic_mapping_reader`;
        await tx`SELECT count(*) FROM pr825_submission_repair.id_map`;
      }),
      /permission denied for schema pr825_submission_repair/,
    );
    await db`DROP ROLE synthetic_mapping_reader`;
    pass("ordinary unrelated role cannot access the private ID mapping");

    await migrate(drizzle(db), { migrationsFolder: source });
    assert.equal(
      (await db`SELECT count(*)::int AS n FROM codex.user_submissions`)[0]!.n,
      1950,
    );
    const [added] = await insert();
    assert.equal(
      (
        await db`SELECT count(*)::int AS n FROM codex_history.user_submissions WHERE row_id = ${String(added!.id)}`
      )[0]!.n,
      1,
    );
    pass(
      "actual PR migrations 0027–0029 succeed after repair and audit new submissions",
    );

    await fixture();
    await db`SELECT setval('codex.user_submissions_id_seq', 5000, true)`;
    await db.unsafe(commitRepair);
    assert.equal((await insert())[0]!.id, 5001);
    pass("advanced sequence is not moved backward");

    await fixture();
    await db`SELECT setval('codex.user_submissions_id_seq', 5000, false)`;
    await db.unsafe(commitRepair);
    assert.equal((await insert())[0]!.id, 5000);
    pass("unused advanced sequence retains its next value");

    await fixture();
    await db.unsafe(`INSERT INTO codex.user_submissions OVERRIDING SYSTEM VALUE
      SELECT * FROM codex.user_submissions WHERE id = 1 AND submission_type = 'new'`);
    await db.unsafe(commitRepair);
    assert.equal(
      (await db`SELECT count(*)::int AS n FROM codex.user_submissions`)[0]!.n,
      1950,
    );
    assert.equal(
      (
        await db`SELECT count(*)::int AS n FROM pr825_submission_repair.id_map WHERE old_id = 1`
      )[0]!.n,
      3,
    );
    pass(
      "triple collision and exact duplicate with tied timestamps preserve all rows",
    );

    await fixture();
    await db.unsafe(`ALTER TABLE codex.user_submissions ALTER COLUMN id SET GENERATED BY DEFAULT;
      UPDATE codex.user_submissions SET id = 2147483647 WHERE id = 1562;
      ALTER TABLE codex.user_submissions ALTER COLUMN id SET GENERATED ALWAYS`);
    await fail(commitRepair, /Insufficient integer/);
    assert.equal(
      (await db`SELECT count(*)::int AS n FROM codex.user_submissions`)[0]!.n,
      1949,
    );
    pass("integer exhaustion aborts without losing rows");

    await fixture();
    await db`SELECT setval('codex.user_submissions_id_seq', 2147483647, true)`;
    const beforeExhaustionRows = await rows();
    const beforeExhaustionSequence = await sequence();
    await fail(commitRepair, /Sequence exhausted/);
    assert.deepEqual(await rows(), beforeExhaustionRows);
    assert.deepEqual(await sequence(), beforeExhaustionSequence);
    await assertNoRepairArtifacts();
    assert.equal(
      (
        await db`SELECT attidentity FROM pg_attribute
      WHERE attrelid = 'codex.user_submissions'::regclass AND attname = 'id'`
      )[0]!.attidentity,
      "a",
    );
    pass(
      "independently exhausted sequence aborts and restores rows, sequence, identity, mapping and PK",
    );

    for (const [label, mutation] of [
      [
        "BY DEFAULT identity",
        "ALTER TABLE codex.user_submissions ALTER COLUMN id SET GENERATED BY DEFAULT",
      ],
      [
        "renamed sequence",
        "ALTER SEQUENCE codex.user_submissions_id_seq RENAME TO unexpected_submission_seq",
      ],
      [
        "sequence increment",
        "ALTER SEQUENCE codex.user_submissions_id_seq INCREMENT BY 2",
      ],
      ["sequence cycle", "ALTER SEQUENCE codex.user_submissions_id_seq CYCLE"],
      [
        "sequence cache",
        "ALTER SEQUENCE codex.user_submissions_id_seq CACHE 2",
      ],
    ] as const) {
      await fixture();
      await db.unsafe(mutation);
      const beforeGuardRows = await rows();
      // The regclass literal resolves during SQL planning, before the custom
      // guard can run when the expected sequence name no longer exists.
      const expectedError =
        label === "renamed sequence"
          ? (error: unknown) =>
              error instanceof postgres.PostgresError &&
              error.code === "42P01" &&
              error.message ===
                'relation "codex.user_submissions_id_seq" does not exist'
          : /Unexpected identity configuration/;
      await fail(commitRepair, expectedError);
      assert.deepEqual(await rows(), beforeGuardRows);
      await assertNoRepairArtifacts();
      pass(`unexpected ${label} is refused without changing rows`);
    }

    await fixture();
    await db.unsafe(`CREATE FUNCTION codex.fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER fixture BEFORE UPDATE ON codex.user_submissions FOR EACH ROW EXECUTE FUNCTION codex.fixture_trigger()`);
    await fail(commitRepair, /Existing key, foreign key, trigger or rule/);
    pass("unexpected trigger fails closed");

    await fixture();
    await second.unsafe(
      "BEGIN; LOCK TABLE codex.user_submissions IN ROW EXCLUSIVE MODE",
    );
    try {
      await fail(commitRepair, /lock timeout/);
    } finally {
      await second.unsafe("ROLLBACK");
    }
    assert.equal(
      (await db`SELECT count(*)::int AS n FROM codex.user_submissions`)[0]!.n,
      1949,
    );
    pass("concurrent writer causes bounded lock timeout without repair");
  } finally {
    await db.end();
    await second.end();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
