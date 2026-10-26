import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Migration 0033 has to behave differently depending on what it finds: no
// codex schema (bootstrap), a codex schema from the Codex dump that lacks keys
// (repair), or a fully provisioned one (no-op). A real Postgres runs each path
// so the catalog-guarded plpgsql is exercised as written. PGlite has a single
// superuser, so the ownership rules the header describes are not modelled.
const MIGRATION = readFileSync(
  new URL("../drizzle/0033_codex_schema.sql", import.meta.url),
  "utf8",
);
const STATEMENTS = MIGRATION.split("--> statement-breakpoint");

const EXPECTED_CONSTRAINTS = [
  ["admins", "admins_email_unique", "u"],
  ["admins", "admins_pkey", "p"],
  ["entries", "entries_pkey", "p"],
  ["entry_references", "entry_references_pkey", "p"],
  ["entry_references", "unique_source_target", "u"],
  ["entry_tags", "entry_tags_pkey", "p"],
  ["references", "references_pkey", "p"],
  ["tags", "tags_name_unique", "u"],
  ["tags", "tags_pkey", "p"],
  ["user_submissions", "user_submissions_pkey", "p"],
];
const EXPECTED_INDEXES = [
  "idx_entry_references_target_entry_id",
  "idx_entry_tags_tag_id",
];

// The codex schema as the Codex dump provisions it: every table, no primary
// keys, the historical UNIQUE on entry_tags, and a nullable tags.id.
const LEGACY_SCHEMA = `
  CREATE SCHEMA codex;
  CREATE TABLE codex.admins (
    id serial NOT NULL, email varchar(255) NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE codex.entries (
    id text NOT NULL, title text NOT NULL, definition text NOT NULL, type text NOT NULL,
    aliases jsonb, video_link text, created_at timestamp NOT NULL, updated_at timestamp NOT NULL,
    mentioned_entries jsonb
  );
  CREATE TABLE codex.entry_references (
    id integer NOT NULL, source_entry_id text NOT NULL, target_entry_id text NOT NULL,
    context text, created_at timestamp, updated_at timestamp
  );
  CREATE TABLE codex.entry_tags (
    entry_id text NOT NULL, tag_id text NOT NULL,
    CONSTRAINT unique_entry_tag UNIQUE (entry_id, tag_id)
  );
  CREATE TABLE codex."references" (
    id serial NOT NULL, from_entry_id integer NOT NULL, to_entry_id integer NOT NULL,
    context varchar, created timestamp NOT NULL, updated timestamp NOT NULL
  );
  CREATE TABLE codex.tags (
    name text NOT NULL, id varchar,
    "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now()
  );
  CREATE TABLE codex.user_submissions (
    id integer GENERATED ALWAYS AS IDENTITY NOT NULL, submission_type text NOT NULL,
    data jsonb NOT NULL, submitter_name text, submitter_email text, status text NOT NULL,
    "timestamp" timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    rejection_reason text, admin_notes text
  );
`;

let db: PGlite;

const migrate = async () => {
  for (const statement of STATEMENTS) await db.exec(statement);
};

const constraints = async () =>
  (
    await db.query<{ tbl: string; conname: string; contype: string }>(`
      SELECT r.relname AS tbl, c.conname, c.contype
      FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      WHERE r.relnamespace = 'codex'::regnamespace AND c.contype IN ('p', 'u')
      ORDER BY 1, 2`)
  ).rows.map((r) => [r.tbl, r.conname, r.contype]);

const indexes = async () =>
  (
    await db.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'codex' AND indexname LIKE 'idx_%' ORDER BY 1`)
  ).rows.map((r) => r.indexname);

const tables = async () =>
  (
    await db.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'codex' AND c.relkind = 'r' ORDER BY 1`)
  ).rows.map((r) => r.relname);

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("DROP SCHEMA IF EXISTS codex CASCADE");
});

describe("migration 0033_codex_schema", () => {
  it("bootstraps a database without a codex schema", async () => {
    await migrate();
    expect(await tables()).toEqual([
      "admins",
      "entries",
      "entry_references",
      "entry_tags",
      "references",
      "tags",
      "user_submissions",
    ]);
    expect(await constraints()).toEqual(EXPECTED_CONSTRAINTS);
    expect(await indexes()).toEqual(EXPECTED_INDEXES);
  });

  it("is a no-op on a second run", async () => {
    await migrate();
    await db.exec(
      `INSERT INTO codex.tags (name, id) VALUES ('ruck', 'ruck'), ('run', 'run')`,
    );
    await migrate();
    expect(await constraints()).toEqual(EXPECTED_CONSTRAINTS);
    expect(await indexes()).toEqual(EXPECTED_INDEXES);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM codex.tags",
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("adds the missing keys and indexes to a schema provisioned from the Codex dump", async () => {
    await db.exec(LEGACY_SCHEMA);
    await db.exec(`
      INSERT INTO codex.tags (name, id) VALUES ('ruck', 'ruck'), ('run', 'run');
      INSERT INTO codex.entry_tags VALUES ('e1', 'ruck'), ('e1', 'run');
    `);
    await migrate();
    expect(await constraints()).toEqual(EXPECTED_CONSTRAINTS);
    expect(await indexes()).toEqual(EXPECTED_INDEXES);
    // The historical UNIQUE on entry_tags is gone, and ADD PRIMARY KEY made
    // tags.id NOT NULL as the snapshot declares.
    const { rows } = await db.query<{ attnotnull: boolean }>(
      `SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'codex.tags'::regclass AND attname = 'id'`,
    );
    expect(rows[0]?.attnotnull).toBe(true);
  });

  it("refuses an existing codex schema that is missing a table", async () => {
    await db.exec(LEGACY_SCHEMA);
    await db.exec("DROP TABLE codex.entry_tags, codex.tags");
    await expect(migrate()).rejects.toThrow(
      /missing tables: entry_tags, tags\. Migration 0033 does not create tables/,
    );
  });

  it("refuses a primary key that exists under another name", async () => {
    await db.exec(LEGACY_SCHEMA);
    await db.exec(
      "ALTER TABLE codex.entries ADD CONSTRAINT entries_id_key PRIMARY KEY (id)",
    );
    await expect(migrate()).rejects.toThrow(
      /codex\.entries has primary key entries_id_key but migration 0033 expects entries_pkey\. Rename it/,
    );
    // Nothing else was touched: the first failure aborts the block.
    expect(await indexes()).toEqual([]);
  });

  it("names the table and column when NULLs block a primary key", async () => {
    await db.exec(LEGACY_SCHEMA);
    await db.exec(
      `INSERT INTO codex.tags (name, id) VALUES ('ruck', 'ruck'), ('orphan', NULL)`,
    );
    await expect(migrate()).rejects.toThrow(
      /codex\.tags: 1 row\(s\) have NULL in \(id\), so tags_pkey cannot be added/,
    );
  });

  it("names the table and columns when duplicates block a key", async () => {
    await db.exec(LEGACY_SCHEMA);
    await db.exec(`
      INSERT INTO codex.entries (id, title, definition, type, created_at, updated_at)
      VALUES ('dup', 'a', 'a', 'term', now(), now()), ('dup', 'b', 'b', 'term', now(), now())
    `);
    await expect(migrate()).rejects.toThrow(
      /codex\.entries: 1 duplicate value\(s\) in \(id\), so entries_pkey cannot be added/,
    );
  });

  it("fails verification when a same-named constraint has the wrong type", async () => {
    await db.exec(LEGACY_SCHEMA);
    // A CHECK constraint named like the unique key must not satisfy either the
    // repair guard (which then tries to add the UNIQUE and collides) or the
    // final verifier.
    await db.exec(
      "ALTER TABLE codex.tags ADD CONSTRAINT tags_name_unique CHECK (name <> '')",
    );
    await expect(migrate()).rejects.toThrow(/tags_name_unique/);
  });
});
