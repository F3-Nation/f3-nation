import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { LoadArgs, LoadDeps, SnapshotManifest } from "./load-snapshot-lib";
import {
  assertColumns,
  assertDumpMatchesManifest,
  assertMigration,
  assertTarListing,
  createLoadDb,
  LIST_ARGS,
  manifestAge,
  NATION_CHECK_SQL,
  parseArgs,
  parseManifest,
  redactStderr,
  restoreArgs,
  runLoad,
  SNAPSHOT_URL,
  truncateSql,
  validateSourceUrl,
} from "./load-snapshot-lib";
import { DISPOSABLE_MARKER } from "./migrate-guards";

vi.mock("./lib/logging", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

const manifest = (over: Partial<SnapshotManifest> = {}): SnapshotManifest => ({
  formatVersion: 1,
  exportedAt: "2026-10-10T12:00:00.000Z",
  migration: { tag: "0031_x", createdAt: 1000 },
  tables: {
    "public.orgs": { rows: 10, columns: ["id", "name"] },
    "public.users": { rows: 5, columns: ["id", "email"] },
  },
  ...over,
});

const TOC = [
  "; Archive created at 2026-10-10",
  "3450; 0 16405 TABLE DATA public orgs f3local",
  "3451; 0 16410 TABLE DATA public users f3local",
].join("\n");

describe("parseArgs", () => {
  it("defaults to the published snapshot", () => {
    expect(parseArgs([])).toEqual({
      url: SNAPSHOT_URL,
      file: undefined,
      yes: false,
    });
  });

  it("reads each flag in both forms", () => {
    expect(parseArgs(["--url", "https://x.test/a.tar", "--yes"])).toMatchObject(
      {
        url: "https://x.test/a.tar",
        yes: true,
      },
    );
    expect(parseArgs(["--file=/tmp/a.tar", "-y"])).toMatchObject({
      file: "/tmp/a.tar",
      yes: true,
    });
  });

  it("accepts an inline value that starts with a dash", () => {
    expect(parseArgs(["--file=-odd.tar"]).file).toBe("-odd.tar");
  });

  it("ignores the leading -- pnpm may forward", () => {
    expect(parseArgs(["--", "--yes"]).yes).toBe(true);
  });

  it.each([
    [["--bogus"], /Unknown argument/],
    [["--url"], /needs a value/],
    [["--url", "--yes"], /--url needs a value/],
    [["--file", "-y"], /--file needs a value/],
    [["--url", "https://x.test", "--file", "a.tar"], /not both/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("snapshot location", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

  it("matches the publisher's object and the IAM condition in setup.sh", () => {
    const config = read("tooling/scripts/src/staging-refresh.config.ts");
    const bucket = /bucket: "([^"]+)"/.exec(config)?.[1];
    const name = /name: "(dev-snapshots\/[^"]+)"/.exec(config)?.[1];
    expect(bucket).toBeDefined();
    expect(name).toBeDefined();
    expect(SNAPSHOT_URL).toBe(
      `https://storage.googleapis.com/${bucket}/${name}`,
    );

    const setup = read("tooling/scripts/staging-refresh/setup.sh");
    expect(/^SNAPSHOT_BUCKET=(\S+)$/m.exec(setup)?.[1]).toBe(bucket);
    const prefix = /^SNAPSHOT_PREFIX=(\S+)$/m.exec(setup)?.[1];
    expect(prefix?.endsWith("/")).toBe(true);
    expect(name?.startsWith(prefix ?? "\0")).toBe(true);

    expect(setup).toContain(
      'SNAPSHOT_CONDITION="resource.name.startsWith(\\"projects/_/buckets/${SNAPSHOT_BUCKET}/objects/${SNAPSHOT_PREFIX}\\")"',
    );
    expect(setup).toContain(
      '--condition "expression=$SNAPSHOT_CONDITION,title=$SNAPSHOT_CONDITION_TITLE"',
    );
  });
});

describe("validateSourceUrl", () => {
  it("accepts https and local http only", () => {
    expect(validateSourceUrl(SNAPSHOT_URL).host).toBe("storage.googleapis.com");
    expect(validateSourceUrl("http://localhost:8080/a.tar").port).toBe("8080");
  });

  it.each([
    "http://evil.test/a.tar",
    "file:///etc/passwd",
    "ftp://x/a",
    "nope",
  ])("rejects %s", (raw) => {
    expect(() => validateSourceUrl(raw)).toThrow();
  });
});

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    expect(parseManifest(JSON.stringify(manifest()))).toEqual(manifest());
  });

  it.each([
    ["bad JSON", "{", /not valid JSON/],
    ["not an object", "[]", /not an object/],
    [
      "a future format",
      JSON.stringify({ ...manifest(), formatVersion: 2 }),
      /not supported/,
    ],
    [
      "a bad date",
      JSON.stringify({ ...manifest(), exportedAt: "soon" }),
      /exportedAt/,
    ],
    [
      "no migration",
      JSON.stringify({ ...manifest(), migration: {} }),
      /migration/,
    ],
    [
      "no tables",
      JSON.stringify({ ...manifest(), tables: {} }),
      /expected 1-100 tables/,
    ],
    [
      "a table that is not public",
      JSON.stringify({
        ...manifest(),
        tables: { "auth.users": { rows: 1, columns: ["id"] } },
      }),
      /not a public table name/,
    ],
    [
      "an injected table name",
      JSON.stringify({
        ...manifest(),
        tables: { "public.x; drop table y": { rows: 1, columns: ["id"] } },
      }),
      /not a public table name/,
    ],
    [
      "an injected column",
      JSON.stringify({
        ...manifest(),
        tables: { "public.x": { rows: 1, columns: ["id; --"] } },
      }),
      /malformed/,
    ],
    [
      "a table with no columns",
      JSON.stringify({
        ...manifest(),
        tables: { "public.x": { rows: 1, columns: [] } },
      }),
      /malformed/,
    ],
  ])("rejects %s", (_, raw, message) => {
    expect(() => parseManifest(raw)).toThrow(message);
  });

  it("rejects a manifest with too many tables", () => {
    const tables = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [
        `public.t${i}`,
        { rows: 1, columns: ["id"] },
      ]),
    );
    expect(() =>
      parseManifest(JSON.stringify({ ...manifest(), tables })),
    ).toThrow(/expected 1-100 tables/);
  });
});

describe("manifestAge", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  it.each([
    ["2026-10-13T11:30:00.000Z", 0, "less than an hour old"],
    ["2026-10-13T11:00:00.000Z", 0, "1 hour old"],
    ["2026-10-13T09:00:00.000Z", 0, "3 hours old"],
    ["2026-10-12T11:00:00.000Z", 1, "1 day old"],
    ["2026-09-01T12:00:00.000Z", 42, "42 days old"],
    ["2027-01-01T00:00:00.000Z", 0, "less than an hour old"],
  ])("%s", (exportedAt, days, text) => {
    expect(manifestAge(exportedAt, now)).toEqual({ days, text });
  });
});

describe("assertDumpMatchesManifest", () => {
  it("passes when the dump holds exactly the manifest's tables", () => {
    expect(() => assertDumpMatchesManifest(TOC, manifest())).not.toThrow();
  });

  it("reports missing and unexpected tables", () => {
    const toc =
      "1; 0 1 TABLE DATA public orgs f3local\n2; 0 2 TABLE DATA public attendance f3local";
    expect(() => assertDumpMatchesManifest(toc, manifest())).toThrow(
      /missing: public\.users; unexpected: public\.attendance/,
    );
  });

  it("says none when only one side differs", () => {
    const orgsOnly = "1; 0 1 TABLE DATA public orgs f3local";
    expect(() => assertDumpMatchesManifest(orgsOnly, manifest())).toThrow(
      /missing: public\.users; unexpected: none/,
    );
    const extra = `${TOC}\n3; 0 3 TABLE DATA public attendance f3local`;
    expect(() => assertDumpMatchesManifest(extra, manifest())).toThrow(
      /missing: none; unexpected: public\.attendance/,
    );
  });
});

describe("assertColumns", () => {
  const local = {
    "public.orgs": ["id", "name", "extra"],
    "public.users": ["id", "email"],
  };

  it("allows extra local columns (local ahead of the snapshot)", () => {
    expect(() => assertColumns(manifest(), local)).not.toThrow();
  });

  it("reports a missing table and a missing column", () => {
    expect(() => assertColumns(manifest(), { "public.orgs": ["id"] })).toThrow(
      /public\.orgs has no local column name; public\.users does not exist locally/,
    );
  });
});

describe("assertMigration", () => {
  it.each([
    [null, /no migration history/],
    [999, /newer than your local database/],
  ])("refuses local %s", (local, message) => {
    expect(() => assertMigration(local, manifest())).toThrow(message);
  });

  it.each([1000, 2000])("accepts local %s (equal or ahead)", (local) => {
    expect(() => assertMigration(local, manifest())).not.toThrow();
  });
});

describe("assertTarListing", () => {
  const entry = (name: string, type = "-") =>
    `${type}rw-r--r--  0 u g  100 Oct 10 12:00 ${name}`;

  it("accepts exactly the two members, in any order", () => {
    expect(() =>
      assertTarListing(
        `${entry("snapshot.dump")}\n${entry("manifest.json")}\n`,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "an extra member",
      `${entry("manifest.json")}\n${entry("snapshot.dump")}\n${entry("evil")}`,
    ],
    ["a missing member", entry("manifest.json")],
    ["a path", `${entry("a/manifest.json")}\n${entry("snapshot.dump")}`],
    ["a traversal", `${entry("../manifest.json")}\n${entry("snapshot.dump")}`],
    [
      "a symlink",
      `${entry("manifest.json -> /etc/passwd", "l")}\n${entry("snapshot.dump")}`,
    ],
    ["nothing", ""],
  ])("refuses %s", (_, listing) => {
    expect(() => assertTarListing(listing)).toThrow();
  });
});

describe("truncateSql", () => {
  it("quotes validated public tables", () => {
    expect(truncateSql(["public.orgs", "public.users"])).toBe(
      'TRUNCATE TABLE "public"."orgs", "public"."users" CASCADE',
    );
  });

  it.each(["auth.users", 'public.x"; drop table y; --', "orgs"])(
    "refuses %s",
    (t) => {
      expect(() => truncateSql([t])).toThrow(/Refusing to truncate/);
    },
  );
});

describe("redactStderr", () => {
  it("keeps the first lines and withholds row data", () => {
    const stderr = [
      "pg_restore: error: COPY failed",
      "DETAIL:  Key (email)=(a@b.c) already exists.",
      "CONTEXT:  COPY users, line 3",
      "",
      "four",
      "five",
      "six",
    ].join("\n");
    const out = redactStderr(stderr);
    expect(out).not.toContain("a@b.c");
    expect(out).not.toContain("line 3");
    expect(out.split(" / ")).toHaveLength(5);
    expect(out).toContain("[row data withheld]");
  });

  it.each([
    'psql:/tmp/f:12: ERROR:  invalid input syntax for type integer: "abc"',
    'ERROR:  invalid input value for enum org_type: "secret"',
  ])("withholds the value an input error quotes: %s", (line) => {
    const out = redactStderr(line);
    expect(out).toMatch(/ERROR: .*: \[value withheld\]$/);
    expect(out).not.toMatch(/"abc"|"secret"/);
  });

  it("keeps quoted names that aren't row values", () => {
    const line =
      'ERROR:  new row for relation "orgs" violates check constraint "c"';
    expect(redactStderr(line)).toBe(line);
  });
});

const TAR_LISTING = [
  "-rw-r--r--  0 u g  100 Oct 10 12:00 manifest.json",
  "-rw-r--r--  0 u g  900 Oct 10 12:00 snapshot.dump",
].join("\n");
const URL_LOCAL = "postgresql://f3local:f3local@localhost:5433/f3nation";
const ok = { code: 0, stdout: "", stderr: "" };

function harness(over: Partial<LoadDeps> = {}) {
  const calls: string[] = [];
  // Restore attempts that reached the default `docker`.
  const restores: string[][] = [];
  const rec =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A): R => {
      calls.push(name);
      return fn(...a);
    };

  const docker = vi.fn((args: string[]) => {
    if (args === LIST_ARGS) {
      calls.push("docker:list");
      return Promise.resolve({ ...ok, stdout: TOC });
    }
    if (args.includes("bash")) {
      restores.push(args);
      calls.push("docker:restore");
      return Promise.resolve(ok);
    }
    calls.push("docker:psql");
    return Promise.resolve({ ...ok, stdout: `${DISPOSABLE_MARKER}|777\n` });
  });

  const deps: LoadDeps = {
    now: () => new Date("2026-10-13T12:00:00.000Z"),
    clock: vi.fn().mockReturnValueOnce(0).mockReturnValue(2500),
    isCI: false,
    isTTY: true,
    databaseUrl: URL_LOCAL,
    targetUrls: [URL_LOCAL],
    assertLocal: vi.fn(rec("assertLocal", () => Promise.resolve())),
    mkTmp: rec("mkTmp", () => Promise.resolve("/tmp/x")),
    rmTmp: vi.fn(rec("rmTmp", () => Promise.resolve())),
    fetchToFile: vi.fn(rec("fetch", () => Promise.resolve())),
    copyFile: vi.fn(rec("copy", () => Promise.resolve())),
    readText: rec("readText", () =>
      Promise.resolve(JSON.stringify(manifest())),
    ),
    tar: vi.fn((args: string[]) => {
      calls.push(args[0] === "-tvf" ? "tar:list" : "tar:extract");
      return Promise.resolve(
        args[0] === "-tvf" ? { ...ok, stdout: TAR_LISTING } : ok,
      );
    }),
    docker,
    confirm: vi.fn(rec("confirm", () => Promise.resolve("y"))),
    db: {
      identity: rec("identity", () =>
        Promise.resolve({
          name: "f3nation",
          marker: DISPOSABLE_MARKER,
          systemId: "777",
        }),
      ),
      localColumns: rec("localColumns", () =>
        Promise.resolve({
          "public.orgs": ["id", "name"],
          "public.users": ["id", "email"],
        }),
      ),
      newestMigration: rec("newestMigration", () => Promise.resolve(1000)),
      analyze: rec("analyze", () => Promise.resolve()),
      recomputeAoCounts: rec("aoCounts", () => Promise.resolve()),
      resetAllSequences: rec("sequences", () => Promise.resolve(3)),
      nationIds: rec("nationIds", () => Promise.resolve([1])),
      regionIdsByName: rec("regionIds", () => Promise.resolve({ Boone: 9 })),
    },
    seeders: {
      seedDevUsers: rec("seedUsers", () =>
        Promise.resolve({
          adminUserId: 1,
          roleIds: { adminId: 1, editorId: 2 },
        }),
      ),
      seedApiKeys: vi.fn(
        rec("seedKeys", () => Promise.resolve(["local-boone-editor-key"])),
      ),
      seedOAuthClients: rec("seedOAuth", () => Promise.resolve()),
    },
    ...over,
  };
  return { deps, calls, restores };
}

const ARGS: LoadArgs = { url: SNAPSHOT_URL, yes: false };

describe("runLoad", () => {
  it("runs the guards, pre-flight, load and seeding in order", async () => {
    const { deps, calls, restores } = harness();
    const result = await runLoad(ARGS, deps);
    expect(result).toEqual({ tables: 2, rows: 15, elapsedMs: 2500 });
    expect(calls).toEqual([
      "assertLocal",
      "identity",
      "docker:psql",
      "mkTmp",
      "fetch",
      "tar:list",
      "tar:extract",
      "readText",
      "docker:list",
      "localColumns",
      "newestMigration",
      "confirm",
      "docker:restore",
      "analyze",
      "aoCounts",
      "sequences",
      "nationIds",
      "seedUsers",
      "regionIds",
      "seedKeys",
      "seedOAuth",
      "rmTmp",
    ]);
    expect(deps.fetchToFile).toHaveBeenCalledWith(
      new URL(SNAPSHOT_URL),
      "/tmp/x/snapshot.tar",
    );
    expect(restores).toHaveLength(1);
    expect(restores[0]).toContain(
      'TRUNCATE_SQL=TRUNCATE TABLE "public"."orgs", "public"."users" CASCADE',
    );
    expect(restores[0]).toContain(`NATION_CHECK_SQL=${NATION_CHECK_SQL}`);
    const script = restores[0]?.at(-1) ?? "";
    expect(script).toMatch(/^set -euo pipefail/);
    expect(script).toMatch(
      /psql .*-v ON_ERROR_STOP=1 --single-transaction -f "\$f"/,
    );
    expect(script).not.toMatch(/pg_restore[^\n]*\|\s*psql/);
  });

  it("copies a local --file instead of downloading", async () => {
    const { deps } = harness();
    await runLoad({ ...ARGS, file: "/tmp/mine.tar", yes: true }, deps);
    expect(deps.copyFile).toHaveBeenCalledWith(
      "/tmp/mine.tar",
      "/tmp/x/snapshot.tar",
    );
    expect(deps.fetchToFile).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("builds region ids from the dev keys' region names", async () => {
    const { deps } = harness();
    const regionIdsByName = vi.spyOn(deps.db, "regionIdsByName");
    await runLoad({ ...ARGS, yes: true }, deps);
    expect(regionIdsByName).toHaveBeenCalledWith(["Boone"]);
    expect(deps.seeders.seedApiKeys).toHaveBeenCalledWith(
      1,
      1,
      { adminId: 1, editorId: 2 },
      { Boone: 9 },
    );
  });

  it("warns about snapshots older than 30 days but still loads", async () => {
    const { deps } = harness({
      now: () => new Date("2027-01-01T00:00:00.000Z"),
    });
    await expect(runLoad({ ...ARGS, yes: true }, deps)).resolves.toMatchObject({
      tables: 2,
    });
  });

  describe("refuses before touching the database", () => {
    const cases: [
      string,
      (d: ReturnType<typeof harness>) => Partial<LoadDeps> | void,
      RegExp,
    ][] = [
      ["CI", () => ({ isCI: true }), /CI is set/],
      [
        "a remote target",
        () => ({
          assertLocal: () =>
            Promise.reject(
              new Error("Refusing to load a snapshot into: remote"),
            ),
        }),
        /Refusing to load a snapshot into/,
      ],
      [
        "another database name",
        () => ({ databaseUrl: "postgresql://u:p@localhost:5433/other" }),
        /only loads the Docker "f3nation"/,
      ],
      [
        "a URL with no database name",
        () => ({ databaseUrl: "postgresql://u:p@localhost:5433" }),
        /DATABASE_URL names ""/,
      ],
      [
        "an unmarked client database",
        (h) => {
          h.deps.db.identity = () =>
            Promise.resolve({
              name: "f3nation",
              marker: null,
              systemId: "777",
            });
        },
        /not a verified disposable/,
      ],
      [
        "the wrong client database name",
        (h) => {
          h.deps.db.identity = () =>
            Promise.resolve({
              name: "x",
              marker: DISPOSABLE_MARKER,
              systemId: "777",
            });
        },
        /not a verified disposable/,
      ],
      [
        "Docker down",
        (h) => {
          h.deps.docker = () =>
            Promise.resolve({
              code: 1,
              stdout: "",
              stderr: "no such container",
            });
        },
        /Docker is required/,
      ],
      [
        "an unmarked container database",
        (h) => {
          h.deps.docker = () => Promise.resolve({ ...ok, stdout: "|777\n" });
        },
        /not marked disposable/,
      ],
      [
        "a different server than Docker's",
        (h) => {
          h.deps.docker = () =>
            Promise.resolve({ ...ok, stdout: `${DISPOSABLE_MARKER}|999\n` });
        },
        /does not reach/,
      ],
    ];
    it.each(cases)("%s", async (_, tweak, message) => {
      const h = harness();
      const over = tweak(h);
      if (over) Object.assign(h.deps, over);
      await expect(runLoad({ ...ARGS, yes: true }, h.deps)).rejects.toThrow(
        message,
      );
      expect(h.restores).toEqual([]);
      expect(h.deps.fetchToFile).not.toHaveBeenCalled();
    });
  });

  describe("fails in pre-flight without truncating, and cleans up", () => {
    const cases: [string, (d: LoadDeps) => void, RegExp][] = [
      [
        "a failed download",
        (d) => {
          d.fetchToFile = vi.fn(() =>
            Promise.reject(new Error("Download failed: 404")),
          );
        },
        /404/,
      ],
      [
        "an unreadable archive",
        (d) => {
          d.tar = () => Promise.resolve({ code: 1, stdout: "", stderr: "bad" });
        },
        /Not a readable tar/,
      ],
      [
        "a wrong archive layout",
        (d) => {
          d.tar = () =>
            Promise.resolve({
              ...ok,
              stdout: "-rw-r--r-- 0 u g 1 Oct 10 12:00 evil",
            });
        },
        /must contain exactly/,
      ],
      [
        "a failed unpack",
        (d) => {
          d.tar = (args) =>
            Promise.resolve(
              args[0] === "-tvf"
                ? { ...ok, stdout: TAR_LISTING }
                : { code: 1, stdout: "", stderr: "disk full" },
            );
        },
        /Could not unpack/,
      ],
      [
        "a bad manifest",
        (d) => {
          d.readText = () => Promise.resolve("{");
        },
        /not valid JSON/,
      ],
      [
        "an unreadable dump",
        (d) => {
          const orig = d.docker;
          d.docker = (args, f) =>
            args === LIST_ARGS
              ? Promise.resolve({ code: 1, stdout: "", stderr: "bad dump" })
              : orig(args, f);
        },
        /could not read the dump/,
      ],
      [
        "a dump that disagrees with its manifest",
        (d) => {
          const orig = d.docker;
          d.docker = (args, f) =>
            args === LIST_ARGS
              ? Promise.resolve({
                  ...ok,
                  stdout: "1; 0 1 TABLE DATA public orgs f3local",
                })
              : orig(args, f);
        },
        /does not match its manifest/,
      ],
      [
        "a schema mismatch",
        (d) => {
          d.db.localColumns = () => Promise.resolve({ "public.orgs": ["id"] });
        },
        /does not fit your local schema/,
      ],
      [
        "a local database behind the snapshot",
        (d) => {
          d.db.newestMigration = () => Promise.resolve(10);
        },
        /newer than your local database/,
      ],
      [
        "a local database with no migrations",
        (d) => {
          d.db.newestMigration = () => Promise.resolve(null);
        },
        /no migration history/,
      ],
      [
        "no terminal and no --yes",
        (d) => {
          d.isTTY = false;
        },
        /pass --yes/,
      ],
      [
        "a declined prompt",
        (d) => {
          d.confirm = () => Promise.resolve("n");
        },
        /Load cancelled/,
      ],
      ["a bad URL", () => undefined, /must be https/],
    ];
    it.each(cases)("%s", async (name, tweak, message) => {
      const { deps, restores } = harness();
      tweak(deps);
      const args =
        name === "a bad URL"
          ? { ...ARGS, url: "http://evil.test/a.tar" }
          : ARGS;
      await expect(runLoad(args, deps)).rejects.toThrow(message);
      expect(restores).toEqual([]);
      expect(deps.rmTmp).toHaveBeenCalledWith("/tmp/x");
    });
  });

  it("accepts 'yes' at the prompt", async () => {
    const { deps } = harness({ confirm: () => Promise.resolve(" YES ") });
    await expect(runLoad(ARGS, deps)).resolves.toMatchObject({ tables: 2 });
  });

  it("reports a failed restore as rolled back, without row data", async () => {
    const { deps } = harness();
    const orig = deps.docker;
    deps.docker = (args, f) =>
      args.includes("bash")
        ? Promise.resolve({
            code: 1,
            stdout: "",
            stderr:
              "pg_restore: error: boom\nDETAIL:  Key (email)=(a@b.c) already exists.",
          })
        : orig(args, f);
    const err = await runLoad({ ...ARGS, yes: true }, deps).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toMatch(/rolled back.*unchanged/);
    expect((err as Error).message).not.toContain("a@b.c");
    expect(deps.rmTmp).toHaveBeenCalled();
  });

  it.each([[[]], [[1, 2]]])(
    "needs exactly one nation org (got %j)",
    async (ids) => {
      const { deps } = harness();
      deps.db.nationIds = () => Promise.resolve(ids);
      await expect(runLoad({ ...ARGS, yes: true }, deps)).rejects.toThrow(
        /exactly one nation org/,
      );
    },
  );

  it("reports a post-restore failure as a partial load, keeping the cause", async () => {
    const { deps } = harness();
    const cause = new Error("seed exploded");
    deps.seeders.seedOAuthClients = () => Promise.reject(cause);
    const err = await runLoad({ ...ARGS, yes: true }, deps).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toMatch(
      /snapshot was loaded, but post-load setup failed.*seed exploded/,
    );
    expect((err as Error).cause).toBe(cause);
  });

  it("reports a non-Error post-restore failure as a partial load", async () => {
    const { deps } = harness();
    const notAnError = "seed exploded" as unknown as Error;
    deps.seeders.seedOAuthClients = () => Promise.reject(notAnError);
    await expect(runLoad({ ...ARGS, yes: true }, deps)).rejects.toThrow(
      /post-load setup failed.*seed exploded/,
    );
  });

  it("keeps the load's own error when the temp dir can't be removed", async () => {
    const { deps } = harness({
      rmTmp: () => Promise.reject(new Error("EACCES")),
      fetchToFile: () => Promise.reject(new Error("Download failed: 404")),
    });
    await expect(runLoad(ARGS, deps)).rejects.toThrow(/404/);
  });

  it("still succeeds when the temp dir can't be removed", async () => {
    const { deps } = harness({
      rmTmp: () => Promise.reject(new Error("EACCES")),
    });
    await expect(runLoad({ ...ARGS, yes: true }, deps)).resolves.toMatchObject({
      tables: 2,
    });
  });
});

describe("restore script", () => {
  // Runs the real script against stub pg_restore/psql on PATH, no Docker.
  const run = (env: Record<string, string> = {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "f3-restore-test-"));
    const stub = (name: string, body: string) => {
      const file = path.join(dir, name);
      writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(file, 0o755);
    };
    // `-l` lists a table, a sequence and a large object; a restore emits
    // what `-L` keeps.
    stub(
      "pg_restore",
      `[ "$(cat "\${@: -1}")" = dump ] || exit 2
if [ "$1" = -l ]; then
  printf '%s\\n' '10; 0 0 TABLE DATA public orgs f3' '11; 0 0 SEQUENCE SET public orgs_id_seq f3' '12; 0 0 BLOBS - BLOBS '
  exit 0
fi
[ "\${FAIL:-}" = 1 ] && exit 1
while [ $# -gt 0 ]; do [ "$1" = -L ] && list="$2"; shift; done
if grep -q 'TABLE DATA' "$list"; then echo "COPY x FROM stdin;"; fi
if grep -q 'SEQUENCE SET' "$list"; then echo "SELECT pg_catalog.setval('orgs_id_seq', 9, true);"; fi
if grep -q 'BLOBS' "$list"; then echo "SELECT pg_catalog.lo_open('16384', 131072);"; fi`,
    );
    stub(
      "psql",
      `echo "$@" > "${dir}/psql.args"
while [ $# -gt 0 ]; do [ "$1" = -f ] && cp "$2" "${dir}/psql.sql"; shift; done`,
    );
    const args = restoreArgs(truncateSql(["public.orgs"]));
    const envFrom = (prefix: string) =>
      args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? "";
    const inherited = { ...process.env };
    const result = spawnSync("bash", ["-c", args.at(-1) ?? ""], {
      input: "dump",
      env: {
        ...inherited,
        PATH: `${dir}${path.delimiter}${inherited.PATH ?? ""}`,
        TRUNCATE_SQL: envFrom("TRUNCATE_SQL="),
        NATION_CHECK_SQL: envFrom("NATION_CHECK_SQL="),
        ...env,
      },
    });
    const read = (f: string) => {
      try {
        return readFileSync(path.join(dir, f), "utf8");
      } catch {
        return null;
      }
    };
    return {
      status: result.status,
      args: read("psql.args"),
      sql: read("psql.sql"),
    };
  };

  it("applies truncate, data and the nation check in one transaction", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.args).toContain("--single-transaction");
    expect(r.args).toContain("ON_ERROR_STOP=1");
    expect(r.sql).toBe(
      [
        "SET client_min_messages = warning;",
        'TRUNCATE TABLE "public"."orgs" CASCADE;',
        "COPY x FROM stdin;",
        NATION_CHECK_SQL,
        "",
      ].join("\n"),
    );
  });

  it("restores only table data", () => {
    // setval is not rolled back, and large objects aren't in the manifest.
    const r = run();
    expect(r.status).toBe(0);
    expect(r.sql).toContain("COPY x FROM stdin;");
    expect(r.sql).not.toContain("setval");
    expect(r.sql).not.toContain("lo_open");
  });

  it("never reaches psql when pg_restore fails", () => {
    const r = run({ FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.args).toBeNull();
  });
});

describe("createLoadDb", () => {
  interface Fake {
    execute: ReturnType<typeof vi.fn>;
  }
  const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL);
  const make = (...results: unknown[][]) => {
    const execute = vi.fn();
    for (const r of results) execute.mockResolvedValueOnce(r);
    execute.mockResolvedValue([]);
    const fake: Fake = { execute };
    return {
      fake,
      loadDb: createLoadDb(fake as never, "__drizzle_migrations_f3nation"),
    };
  };

  it("reads identity and fails when the row is missing", async () => {
    const a = make([{ name: "f3nation", marker: "m", system_id: "1" }]);
    await expect(a.loadDb.identity()).resolves.toEqual({
      name: "f3nation",
      marker: "m",
      systemId: "1",
    });
    await expect(make([]).loadDb.identity()).rejects.toThrow(/Could not read/);
  });

  it("groups local columns by public table", async () => {
    const { fake, loadDb } = make([
      { table_name: "orgs", column_name: "id" },
      { table_name: "orgs", column_name: "name" },
      { table_name: "users", column_name: "id" },
    ]);
    await expect(
      loadDb.localColumns(["public.orgs", "public.users"]),
    ).resolves.toEqual({
      "public.orgs": ["id", "name"],
      "public.users": ["id"],
    });
    const q = render(fake.execute.mock.calls[0]?.[0]);
    expect(q.sql).toContain("table_schema = 'public'");
    expect(q.sql).toContain("IN ($1, $2)");
    expect(q.params).toEqual(["orgs", "users"]);
  });

  it("reads the newest migration, or null without a history table or rows", async () => {
    const found = make([{ "?column?": 1 }], [{ newest: "1746334397565" }]);
    await expect(found.loadDb.newestMigration()).resolves.toBe(1746334397565);
    const [exists, newest] = found.fake.execute.mock.calls.map(([q]) =>
      render(q),
    );
    expect(exists?.params).toContain("__drizzle_migrations_f3nation");
    expect(newest?.sql).toContain('drizzle."__drizzle_migrations_f3nation"');
    await expect(make([]).loadDb.newestMigration()).resolves.toBeNull();
    await expect(
      make([{ x: 1 }], [{ newest: null }]).loadDb.newestMigration(),
    ).resolves.toBeNull();
  });

  it("analyzes, recomputes ao_count over the whole tree, and resets sequences", async () => {
    const { fake, loadDb } = make();
    await loadDb.analyze();
    expect(fake.execute).toHaveBeenCalledTimes(1);
    await loadDb.recomputeAoCounts();
    expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(render(fake.execute.mock.calls[1]?.[0]).sql).toBe(
      "SELECT public.recount_org_ao_counts()",
    );
    await expect(loadDb.resetAllSequences()).resolves.toBe(0);
  });

  it("lists nation ids and maps region names to the lowest id", async () => {
    const { fake, loadDb } = make(
      [{ id: 1 }, { id: 2 }],
      [
        { id: 9, name: "Boone" },
        { id: 4, name: "Boone" },
      ],
    );
    await expect(loadDb.nationIds()).resolves.toEqual([1, 2]);
    await expect(loadDb.regionIdsByName(["Boone"])).resolves.toEqual({
      Boone: 4,
    });
    const regions = render(fake.execute.mock.calls[1]?.[0]);
    expect(regions.sql).toContain("org_type = 'region'");
    expect(regions.sql).toContain("ORDER BY id DESC");
    expect(regions.params).toEqual(["Boone"]);
    await expect(loadDb.regionIdsByName([])).resolves.toEqual({});
  });
});
