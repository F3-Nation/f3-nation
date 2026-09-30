import { describe, expect, it } from "vitest";

import { getDatabaseNameFromUri, splitSocketHost } from "@acme/db/testing";

// Cloud SQL Unix-socket support in the shared client. Pure URL handling;
// the socket connection itself needs a real /cloudsql mount and is covered
// by the staging cutover drill (ADR 0004 §7 step 3).
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

  it("handles a credential-less URL", () => {
    expect(splitSocketHost(`postgres:///f3_prod?host=${SOCKET}`)).toEqual({
      url: "postgres://localhost/f3_prod",
      socketHost: SOCKET,
    });
  });
});

describe("getDatabaseNameFromUri", () => {
  it("reads the database name without the query string", () => {
    // migrate.ts names its migrations table after this value; the old
    // split("/").pop() returned "f3_prod?host=…" for a socket URL.
    expect(
      getDatabaseNameFromUri(`postgres://api:pw@/f3_prod?host=${SOCKET}`),
    ).toBe("f3_prod");
    expect(getDatabaseNameFromUri("postgres://u:p@h:6432/f3_prod")).toBe(
      "f3_prod",
    );
  });
});
