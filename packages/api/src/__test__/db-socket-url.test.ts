import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  getDatabaseNameFromUri,
  migrationsDatabaseName,
  postgresArgs,
  splitSocketHost,
} from "@acme/db/testing";

// Cloud SQL Unix-socket support in the shared client. No socket is
// available in CI, so the connection-level check below asserts what
// postgres.js itself resolves from the client's arguments (constructing a
// client is lazy — it never connects); the live socket path is exercised by
// the staging cutover drill.
const SOCKET = "/cloudsql/f3data:us-central1:f3data";

describe("splitSocketHost", () => {
  it("leaves TCP URLs untouched — every URL in use today", () => {
    for (const url of [
      "postgres://api:pw@pgbouncer.prod.db.f3nation.com:6432/f3_prod",
      "postgresql://u:p@localhost:5432/f3_test?sslmode=disable",
      "postgres://u:p@10.0.0.4/f3_prod?host=10.0.0.5",
    ]) {
      expect(splitSocketHost(url)).toEqual({ url });
    }
  });

  it("splits a libpq-style socket host out of an empty-host URL", () => {
    expect(
      splitSocketHost(`postgres://api:pw@/f3_prod?host=${SOCKET}`),
    ).toEqual({
      url: "postgres://api:pw@localhost/f3_prod",
      socketHost: SOCKET,
    });
  });

  it("accepts a percent-encoded socket path and keeps other parameters", () => {
    expect(
      splitSocketHost(
        `postgresql://api:pw@localhost/f3_prod?application_name=api&host=${encodeURIComponent(SOCKET)}`,
      ),
    ).toEqual({
      url: "postgresql://api:pw@localhost/f3_prod?application_name=api",
      socketHost: SOCKET,
    });
  });

  it("keeps every other parameter byte-for-byte", () => {
    // No parse/re-serialize round trip: %20 must not become +, and the
    // parameter order is kept.
    expect(
      splitSocketHost(
        `postgres://api:pw@/f3_prod?application_name=api%20map&host=${SOCKET}&options=-c%20x%3Dy`,
      ).url,
    ).toBe(
      "postgres://api:pw@localhost/f3_prod?application_name=api%20map&options=-c%20x%3Dy",
    );
  });

  it("handles a credential-less URL", () => {
    expect(splitSocketHost(`postgres:///f3_prod?host=${SOCKET}`)).toEqual({
      url: "postgres://localhost/f3_prod",
      socketHost: SOCKET,
    });
  });
});

describe("splitSocketHost query-string branches", () => {
  it.each([
    [
      "host= as the only parameter leaves no stray ?",
      "postgres://api:pw@/f3_prod?host=/s",
      { url: "postgres://api:pw@localhost/f3_prod", socketHost: "/s" },
    ],
    [
      "host= first of several leaves no leading &",
      "postgres://api:pw@/f3_prod?host=/s&sslmode=disable",
      {
        url: "postgres://api:pw@localhost/f3_prod?sslmode=disable",
        socketHost: "/s",
      },
    ],
    [
      "an encoded password survives",
      "postgres://api:p%40ss%2Fw@/f3_prod?host=/s",
      { url: "postgres://api:p%40ss%2Fw@localhost/f3_prod", socketHost: "/s" },
    ],
    [
      "the last socket host= wins; a TCP host= stays in the URL",
      "postgres://api:pw@h/f3_prod?host=10.0.0.5&host=/sock",
      { url: "postgres://api:pw@h/f3_prod?host=10.0.0.5", socketHost: "/sock" },
    ],
  ])("%s", (_name, input, expected) => {
    expect(splitSocketHost(input)).toEqual(expected);
  });

  it("names the only-parameter case's table after the bare database", () => {
    expect(migrationsDatabaseName("postgres://api:pw@/f3_prod?host=/s")).toBe(
      "f3_prod",
    );
  });

  it.each([
    ["an empty host=", "postgres://api:pw@h/f3_prod?host="],
    ["a valueless host", "postgres://api:pw@h/f3_prod?host"],
    ["a relative host=", "postgres://api:pw@h/f3_prod?host=relative/dir"],
    ["a TCP host=", "postgres://api:pw@h/f3_prod?host=10.0.0.5"],
  ])("leaves %s on a TCP URL unchanged", (_name, url) => {
    expect(splitSocketHost(url)).toEqual({ url });
  });

  it.each([
    [
      "cloudsql/ without the leading slash",
      `postgres://api:pw@/f3_prod?host=${encodeURIComponent("cloudsql/f3data:us-central1:f3data")}`,
    ],
    [
      "a bare connection name",
      "postgres://api:pw@h/f3_prod?host=f3data:us-central1:f3data",
    ],
  ])("rejects a socket typo: %s", (_name, url) => {
    expect(() => splitSocketHost(url)).toThrow(/does not start with '\/'/);
  });

  it("does not leak the URL (credentials) in either error", () => {
    for (const url of [
      "postgres://api:s3cret@/f3_prod?host=cloudsql/x",
      "postgres://api:s3cret@/f3_prod",
    ]) {
      let message = "";
      try {
        splitSocketHost(url);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("s3cret");
    }
  });

  it("rejects an empty URL host with no socket host= clearly", () => {
    expect(() => splitSocketHost("postgres://api:pw@/f3_prod")).toThrow(
      /no host after '@'/,
    );
    expect(() =>
      splitSocketHost("postgres://api:pw@/f3_prod?sslmode=disable"),
    ).toThrow(/no host after '@'/);
  });

  it("still allows a credential-less, host-less URL (postgres.js defaults to localhost)", () => {
    expect(splitSocketHost("postgres:///f3_prod")).toEqual({
      url: "postgres:///f3_prod",
    });
  });
});

describe("postgresArgs", () => {
  it("makes postgres.js resolve the Cloud SQL socket path", () => {
    const { url, hostOptions } = postgresArgs(
      `postgres://api:pw@/f3_prod?host=${SOCKET}`,
    );
    const client = postgres(url, { ...hostOptions, max: 1 });
    expect(client.options.path).toBe(`${SOCKET}/.s.PGSQL.5432`);
    expect(client.options.database).toBe("f3_prod");
  });

  it("leaves a TCP URL on TCP", () => {
    const { url, hostOptions } = postgresArgs(
      "postgres://api:pw@pgbouncer.prod.db.f3nation.com:6432/f3_prod",
    );
    const client = postgres(url, { ...hostOptions, max: 1 });
    expect(hostOptions).toEqual({});
    expect(client.options.path).toBe(false);
    expect(client.options.host).toEqual(["pgbouncer.prod.db.f3nation.com"]);
  });
});

describe("migrationsDatabaseName", () => {
  it("keeps the legacy name for TCP URLs, query string included", () => {
    // Existing environments' migration history lives in a table named after
    // this value; changing it would re-run every migration.
    expect(migrationsDatabaseName("postgres://u:p@h:6432/f3_prod")).toBe(
      "f3_prod",
    );
    expect(
      migrationsDatabaseName("postgres://u:p@h/f3_test?sslmode=disable"),
    ).toBe("f3_test?sslmode=disable");
  });

  it("names a socket URL's table exactly like the equivalent TCP URL's", () => {
    // Only the socket host= is ignored; any other parameter still counts,
    // as it always has, so switching transport never moves the history.
    expect(
      migrationsDatabaseName(`postgres://api:pw@/f3_prod?host=${SOCKET}`),
    ).toBe(migrationsDatabaseName("postgres://api:pw@h:6432/f3_prod"));
    expect(
      migrationsDatabaseName(
        `postgres://api:pw@/f3_test?host=${SOCKET}&sslmode=disable`,
      ),
    ).toBe(
      migrationsDatabaseName("postgres://api:pw@h/f3_test?sslmode=disable"),
    );
    expect(
      migrationsDatabaseName(
        `postgres://api:pw@/f3_prod?application_name=api%20map&host=${SOCKET}`,
      ),
    ).toBe(
      migrationsDatabaseName(
        "postgres://api:pw@h/f3_prod?application_name=api%20map",
      ),
    );
  });
});

describe("getDatabaseNameFromUri", () => {
  it("reads the database name without the query string", () => {
    expect(
      getDatabaseNameFromUri(`postgres://api:pw@/f3_prod?host=${SOCKET}`),
    ).toBe("f3_prod");
    expect(getDatabaseNameFromUri("postgres://u:p@h:6432/f3_prod")).toBe(
      "f3_prod",
    );
  });
});
