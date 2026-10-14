import { describe, expect, it, vi } from "vitest";

import type { AppliedRow, JournalEntry } from "./migrate-guards";
import {
  assertLocalTarget,
  checkGitState,
  checkPlan,
  classifyHost,
  confirmationMatches,
  connectionHint,
  ENVIRONMENTS,
  isCloudSqlServer,
  isMainRepoUrl,
  isProtectedDatabaseName,
  maintenanceUrl,
  planMigrations,
} from "./migrate-guards";

// The server lookup behind isCloudSqlServer.
const pg = vi.hoisted(() => ({
  rows: [{ cloudsql: false }] as { cloudsql: boolean }[],
  end: vi.fn(() => Promise.resolve()),
}));
vi.mock("postgres", () => ({
  default: () => Object.assign(() => Promise.resolve(pg.rows), { end: pg.end }),
}));

describe("classifyHost", () => {
  it.each([
    "postgresql://f3local:f3local@localhost:5433/f3nation",
    "postgresql://u:p@127.0.0.1:5432/f3nation",
    "postgresql://u:p@[::1]:5432/f3nation",
    "postgresql://u:p@LOCALHOST/f3nation",
    "postgresql://u:p@localhost/f3nation?host=/var/run/postgresql",
    "postgresql://u:p@localhost/f3nation?host=%2Ftmp",
    // An empty host with a local socket: postgresArgs and libpq accept it.
    "postgresql://u:p@/f3nation?host=/var/run/postgresql",
  ])("local: %s", (url) => {
    expect(classifyHost(url)).toBe("local");
  });

  it.each([
    "postgresql://u:p@34.66.1.2:5432/f3_prod",
    "postgresql://u:p@db.example.com/f3nation",
    "postgresql://u:p@localhost/f3_prod?host=/cloudsql/f3data:us-central1:f3data",
    "postgresql://u:p@localhost/f3_prod?host=%2Fcloudsql%2Ff3data%3Aus-central1%3Af3data",
    // A socket and a TCP host together: clients disagree on which wins.
    "postgresql://u:p@localhost/f3nation?host=/var/run/postgresql&host=10.0.0.5",
    "postgresql://u:p@/f3nation?host=10.0.0.5&host=/var/run/postgresql",
    // libpq lets a TCP host= override the URL's host.
    "postgresql://u:p@localhost/f3nation?host=10.0.0.5",
    // Unparseable: never assumed local.
    "postgresql://u:p@/f3_prod?host=/cloudsql/f3data:us-central1:f3data",
    "not a url",
  ])("remote: %s", (url) => {
    expect(classifyHost(url)).toBe("remote");
  });
});

describe("maintenanceUrl", () => {
  it.each([
    [
      "postgresql://f3local:f3local@localhost:5433/f3nation",
      "postgresql://f3local:f3local@localhost:5433/postgres",
    ],
    // A user named like the database keeps its name.
    [
      "postgresql://f3nation:pw@localhost/f3nation",
      "postgresql://f3nation:pw@localhost/postgres",
    ],
    [
      "postgresql://u:p@/f3nation?host=/var/run/postgresql",
      "postgresql://u:p@/postgres?host=/var/run/postgresql",
    ],
    [
      "postgresql://u:p@localhost/f3nation?sslmode=disable",
      "postgresql://u:p@localhost/postgres?sslmode=disable",
    ],
    ["postgresql:///f3nation", "postgresql:///postgres"],
    // No database in the URL: add one rather than rewrite the host.
    [
      "postgresql://u:p@localhost:5432",
      "postgresql://u:p@localhost:5432/postgres",
    ],
    [
      "postgresql://u:p@localhost?sslmode=disable",
      "postgresql://u:p@localhost/postgres?sslmode=disable",
    ],
  ])("%s", (url, expected) => {
    expect(maintenanceUrl(url)).toBe(expected);
  });
});

describe("isMainRepoUrl", () => {
  it.each([
    "https://github.com/F3-Nation/f3-nation.git",
    "https://github.com/F3-Nation/f3-nation",
    "https://github.com/f3-nation/f3-nation/",
    "git@github.com:F3-Nation/f3-nation.git",
    "ssh://git@github.com/F3-Nation/f3-nation.git",
  ])("main: %s", (url) => {
    expect(isMainRepoUrl(url)).toBe(true);
  });
  it.each([
    "https://gitlab.com/F3-Nation/f3-nation.git",
    "https://github.com.evil.example/F3-Nation/f3-nation.git",
    "https://evil.example/github.com/F3-Nation/f3-nation.git",
    "file:///tmp/F3-Nation/f3-nation",
    "/tmp/F3-Nation/f3-nation",
    "git@evil.example:F3-Nation/f3-nation.git",
    "https://github.com/someone/F3-Nation/f3-nation.git",
    "https://github.com/F3-Nation/f3-nation-fork.git",
    "http://github.com/F3-Nation/f3-nation.git",
  ])("not main: %s", (url) => {
    expect(isMainRepoUrl(url)).toBe(false);
  });
});

describe("isProtectedDatabaseName", () => {
  it.each([
    "f3_prod",
    "f3_staging",
    "F3_PROD",
    "my-prod",
    "staging",
    "x_production",
  ])("protects %s", (name) => {
    expect(isProtectedDatabaseName(name)).toBe(true);
  });
  it.each([
    "f3nation",
    "f3nation_test",
    "f3_copy",
    "nonprod_thing",
    "products",
  ])("allows %s", (name) => {
    expect(isProtectedDatabaseName(name)).toBe(false);
  });
});

describe("checkGitState", () => {
  const clean = { differsFromMain: false, localChanges: [], headOnMain: true };

  it("allows main itself", () => {
    expect(checkGitState(clean)).toBeNull();
  });

  it("allows a branch whose migrations are main's", () => {
    expect(checkGitState({ ...clean, headOnMain: false })).toBeNull();
  });

  it("allows a release commit on main that is behind main", () => {
    expect(checkGitState({ ...clean, differsFromMain: true })).toBeNull();
  });

  it("refuses a branch with migrations main doesn't have (2026-10-08)", () => {
    expect(
      checkGitState({ ...clean, differsFromMain: true, headOnMain: false }),
    ).toMatch(/not main's/);
  });

  it("refuses local changes, even on main", () => {
    const refusal = checkGitState({
      ...clean,
      localChanges: ["?? packages/db/drizzle/0031_new.sql"],
    });
    expect(refusal).toMatch(/uncommitted or untracked/);
    expect(refusal).toContain("0031_new.sql");
  });
});

describe("planMigrations / checkPlan", () => {
  const journal: JournalEntry[] = [
    { tag: "0000_a", when: 100 },
    { tag: "0001_b", when: 200 },
    { tag: "0002_c", when: 300 },
    { tag: "0003_d", when: 400 },
  ];
  const hashes = new Map([
    [100, "h0"],
    [200, "h1"],
    [300, "h2"],
    [400, "h3"],
  ]);
  const rows = (...whens: number[]): AppliedRow[] =>
    whens.map((w) => ({ createdAt: w, hash: hashes.get(w) ?? "x" }));

  it("pending = entries newer than the newest applied row", () => {
    const plan = planMigrations(journal, rows(100, 200), hashes, []);
    expect(plan.pending.map((e) => e.tag)).toEqual(["0002_c", "0003_d"]);
    expect(checkPlan(plan, "f3_staging")).toBeNull();
  });

  it("nothing pending when up to date", () => {
    const plan = planMigrations(journal, rows(100, 200, 300, 400), hashes, []);
    expect(plan.pending).toEqual([]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("refuses rows newer than main's newest migration (2026-10-08)", () => {
    const plan = planMigrations(
      journal,
      [...rows(100, 200, 300, 400), { createdAt: 500, hash: "branch" }],
      hashes,
      [],
    );
    expect(plan.unknownRows).toEqual([{ createdAt: 500, hash: "branch" }]);
    expect(checkPlan(plan, "f3_prod")).toMatch(
      /migration\(s\) this checkout doesn't know about/,
    );
  });

  it("refuses unknown rows older than main's newest, too", () => {
    const plan = planMigrations(
      journal,
      [...rows(100, 200), { createdAt: 250, hash: "?" }],
      hashes,
      [],
    );
    expect(checkPlan(plan, "f3_staging")).toMatch(/doesn't know about/);
  });

  it("refuses an entry Drizzle would silently skip", () => {
    // 0001_b missing while 0002_c is applied: its when <= the newest row.
    const plan = planMigrations(journal, rows(100, 300), hashes, []);
    expect(plan.skipped.map((e) => e.tag)).toEqual(["0001_b"]);
    expect(plan.pending.map((e) => e.tag)).toEqual(["0003_d"]);
    expect(checkPlan(plan, "f3_prod")).toMatch(/silently\s+skip/);
  });

  it("allows a skipped entry that is known for this database", () => {
    const plan = planMigrations(journal, rows(100, 300), hashes, ["0001_b"]);
    expect(plan.skipped).toEqual([]);
    expect(plan.knownSkipped.map((e) => e.tag)).toEqual(["0001_b"]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("only notes a hash that changed after the migration ran", () => {
    const plan = planMigrations(
      journal,
      [{ createdAt: 100, hash: "edited" }, ...rows(200)],
      hashes,
      [],
    );
    expect(plan.hashMismatches.map((e) => e.tag)).toEqual(["0000_a"]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("an empty database gets every migration", () => {
    const plan = planMigrations(journal, [], hashes, []);
    expect(plan.pending).toHaveLength(4);
  });

  it("prod's known skip is 0008_nice_leech only", () => {
    expect(ENVIRONMENTS.prod.knownSkipped).toEqual(["0008_nice_leech"]);
    expect(ENVIRONMENTS.staging.knownSkipped).toEqual([]);
  });
});

describe("confirmationMatches", () => {
  it("needs the exact database name", () => {
    expect(confirmationMatches("f3_prod", "f3_prod")).toBe(true);
    expect(confirmationMatches("  f3_prod\n", "f3_prod")).toBe(true);
    expect(confirmationMatches("y", "f3_prod")).toBe(false);
    expect(confirmationMatches("F3_PROD", "f3_prod")).toBe(false);
    expect(confirmationMatches("f3_staging", "f3_prod")).toBe(false);
  });
});

describe("assertLocalTarget", () => {
  const LOCAL = "postgresql://u:p@localhost:5432/f3nation";
  const notCloudSql = () => Promise.resolve(false);

  it.each([
    ["a remote host", "postgresql://u:p@34.66.1.2/f3nation"],
    ["a prod-named database", "postgresql://u:p@localhost/f3_prod"],
    [
      "a Cloud SQL socket",
      "postgresql://u:p@localhost/f3_prod?host=/cloudsql/f3data:us-central1:f3data",
    ],
  ])("refuses %s without asking the server", async (_, url) => {
    const lookup = vi.fn(notCloudSql);
    await expect(assertLocalTarget(url, undefined, lookup)).rejects.toThrow(
      /Refusing to migrate/,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a localhost URL whose server is Cloud SQL (a proxy)", async () => {
    const lookup = vi.fn(() => Promise.resolve(true));
    await expect(assertLocalTarget(LOCAL, undefined, lookup)).rejects.toThrow(
      /reaches a Cloud SQL server/,
    );
    // Asked from the maintenance database, which exists before f3nation does.
    expect(lookup).toHaveBeenCalledWith(
      "postgresql://u:p@localhost:5432/postgres",
    );
  });

  it("allows a local database", async () => {
    await expect(
      assertLocalTarget(LOCAL, undefined, notCloudSql),
    ).resolves.toBeUndefined();
  });

  it("words every refusal with the caller's action and help", async () => {
    const action = { verb: "load a snapshot into", help: "Use Docker." };
    await expect(
      assertLocalTarget("postgresql://u:p@34.66.1.2/f3nation", action),
    ).rejects.toThrow(/Refusing to load a snapshot into: .*Use Docker\./);
    await expect(
      assertLocalTarget("postgresql://u:p@localhost/f3_prod", action),
    ).rejects.toThrow(/Refusing to load a snapshot into database "f3_prod"/);
    await expect(
      assertLocalTarget(LOCAL, action, () => Promise.resolve(true)),
    ).rejects.toThrow(/Refusing to load a snapshot into: .*Cloud SQL/);
  });
});

describe("isCloudSqlServer", () => {
  const URL = "postgresql://u:p@localhost:5432/postgres";

  it("is true when the server has the Cloud SQL superuser role", async () => {
    pg.rows = [{ cloudsql: true }];
    await expect(isCloudSqlServer(URL)).resolves.toBe(true);
  });

  it("is false for a plain Postgres", async () => {
    pg.rows = [{ cloudsql: false }];
    await expect(isCloudSqlServer(URL)).resolves.toBe(false);
  });

  it("is false when the lookup returns no row, and always closes the client", async () => {
    pg.rows = [];
    pg.end.mockClear();
    await expect(isCloudSqlServer(URL)).resolves.toBe(false);
    expect(pg.end).toHaveBeenCalledOnce();
  });
});

describe("connectionHint", () => {
  const PROD = "f3data:us-central1:f3data";
  const refused = new Error("connect ECONNREFUSED 127.0.0.1:5481");

  it("names the port and the proxy command when nothing listens locally", () => {
    const hint = connectionHint(
      refused,
      "postgresql://db_migrator:s3cret@127.0.0.1:5481/f3_prod",
      PROD,
    );
    expect(hint).toContain("Nothing is listening at 127.0.0.1:5481");
    expect(hint).toContain(`cloud-sql-proxy ${PROD} --port 5481`);
  });

  it("never includes the login", () => {
    const errors = [
      refused,
      new Error("timeout"),
      new Error("other"),
      new Error('password authentication failed for user "db_migrator"'),
      Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
    ];
    const urls = [
      "postgresql://db_migrator:s3cret@127.0.0.1:5481/f3_prod",
      "postgresql://db_migrator:s3cret@/f3_prod?host=/cloudsql/x",
      "postgresql://db_migrator:s3cret@10.0.0.5:5432/f3_prod",
      "postgresql://db_migrator:s3cret@127.0.0.1/f3_prod",
    ];
    for (const e of errors) {
      for (const url of urls) {
        const hint = connectionHint(e, url, PROD);
        expect(hint).not.toContain("s3cret");
        expect(hint).not.toContain("db_migrator");
      }
    }
  });

  it("defaults the port to 5432 when the URL has none", () => {
    const hint = connectionHint(
      refused,
      "postgresql://u:p@127.0.0.1/f3_prod",
      PROD,
    );
    expect(hint).toContain("Nothing is listening at 127.0.0.1:5432");
    expect(hint).toContain(`cloud-sql-proxy ${PROD} --port 5432`);
  });

  it("treats an upper-case local host as local", () => {
    expect(
      connectionHint(refused, "postgresql://u:p@LOCALHOST:5481/f3_prod", PROD),
    ).toContain(`cloud-sql-proxy ${PROD} --port 5481`);
  });

  it("reports an unusable URL as a bad secret, without echoing it", () => {
    for (const url of ["not a url", "postgresql://u:p@[::1/f3_prod", ""]) {
      const hint = connectionHint(new Error("x"), url, PROD);
      expect(hint).toBe(
        "The migration URL couldn't be parsed. Ask an admin to check the secret.",
      );
      expect(hint).not.toContain("base");
      if (url) expect(hint).not.toContain(url);
    }
  });

  it("classifies by error code when the message doesn't say", () => {
    const withCode = (code: string) =>
      Object.assign(new Error("connect failed"), { code });
    const local = "postgresql://u:p@127.0.0.1:5481/f3_prod";
    expect(connectionHint(withCode("ECONNREFUSED"), local, PROD)).toContain(
      `cloud-sql-proxy ${PROD} --port 5481`,
    );
    expect(connectionHint(withCode("CONNECTION_CLOSED"), local, PROD)).toMatch(
      /gcloud auth application-default login/,
    );
    expect(connectionHint(withCode("CONNECT_TIMEOUT"), local, PROD)).toMatch(
      /\(timed out\)\. Is the proxy running/,
    );
    expect(connectionHint(withCode("28P01"), local, PROD)).toMatch(
      /rejected the login/,
    );
  });

  it("names the error code when it doesn't recognise the failure", () => {
    const hint = connectionHint(
      Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
      "postgresql://u:p@db.example.test:5432/f3_prod",
      PROD,
    );
    expect(hint).toBe(
      "Couldn't connect to the database at db.example.test:5432 (ENOTFOUND).",
    );
  });

  it("doesn't suggest the proxy for a remote host or a socket", () => {
    expect(
      connectionHint(refused, "postgresql://u:p@10.0.0.5:5432/f3_prod", PROD),
    ).toBe(
      "Nothing is listening at 10.0.0.5:5432. Check the migration URL's host, or ask an admin.",
    );
    expect(
      connectionHint(
        new Error("connect ENOENT /cloudsql/x/.s.PGSQL.5432"),
        "postgresql://u:p@/f3_prod?host=/cloudsql/x",
        PROD,
      ),
    ).toContain("Nothing is listening at socket /cloudsql/x");
  });

  it("points a dropped local connection at the proxy's credentials", () => {
    expect(
      connectionHint(
        new Error("write CONNECTION_CLOSED 127.0.0.1:5481"),
        "postgresql://u:p@127.0.0.1:5481/f3_prod",
        PROD,
      ),
    ).toMatch(/gcloud auth application-default login/);
  });

  it("blames the proxy, not IP access, for a socket timeout", () => {
    const hint = connectionHint(
      new Error("write CONNECT_TIMEOUT"),
      "postgresql://u:p@/f3_prod?host=/cloudsql/x",
      PROD,
    );
    expect(hint).toContain(
      "socket /cloudsql/x (timed out). Is the proxy running?",
    );
    expect(hint).not.toMatch(/IP/);
  });

  it("explains timeouts and a rejected login", () => {
    expect(
      connectionHint(
        new Error("write CONNECT_TIMEOUT"),
        "postgresql://u:p@127.0.0.1:5482/f3_staging",
        PROD,
      ),
    ).toMatch(/127\.0\.0\.1:5482 \(timed out\)\. Is the proxy running/);
    expect(
      connectionHint(
        new Error('password authentication failed for user "u"'),
        "postgresql://u:p@127.0.0.1:5482/f3_staging",
        PROD,
      ),
    ).toMatch(/rejected the login/);
  });
});
