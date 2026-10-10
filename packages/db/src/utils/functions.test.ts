import { describe, expect, it } from "vitest";

import {
  getDatabaseNameFromUri,
  migrationsDatabaseName,
  poolOptions,
  postgresArgs,
  splitSocketHost,
} from "./functions";

const SOCKET = "/cloudsql/f3data:us-central1:f3data";

describe("splitSocketHost", () => {
  it("returns a TCP URL unchanged, including a TCP-style host=", () => {
    const tcp = "postgresql://u:p@127.0.0.1:5432/f3_prod";
    expect(splitSocketHost(tcp)).toEqual({ url: tcp });
    const tcpHost = `${tcp}?host=10.0.0.5&sslmode=disable`;
    expect(splitSocketHost(tcpHost)).toEqual({ url: tcpHost });
  });

  it("splits out a socket host= and fills the empty URL host", () => {
    expect(splitSocketHost(`postgres://u:p@/f3_prod?host=${SOCKET}`)).toEqual({
      url: "postgres://u:p@localhost/f3_prod",
      socketHost: SOCKET,
    });
    expect(splitSocketHost(`postgresql:///f3_prod?host=${SOCKET}`)).toEqual({
      url: "postgresql://localhost/f3_prod",
      socketHost: SOCKET,
    });
  });

  it("keeps every other parameter byte-for-byte, and the last socket wins", () => {
    expect(
      splitSocketHost(
        `postgres://u:p@/f3_prod?application_name=a%20b&host=/tmp&host=${encodeURIComponent(SOCKET)}`,
      ),
    ).toEqual({
      url: "postgres://u:p@localhost/f3_prod?application_name=a%20b",
      socketHost: SOCKET,
    });
  });

  it("refuses a socket path missing its leading slash", () => {
    expect(() =>
      splitSocketHost("postgres://u:p@/f3_prod?host=cloudsql/f3data:r:i"),
    ).toThrow(/does not start with '\/'/);
    expect(() =>
      splitSocketHost("postgres://u:p@/f3_prod?host=f3data:us-central1:f3data"),
    ).toThrow(/does not start with '\/'/);
  });

  it("refuses an empty URL host with no socket host=", () => {
    expect(() => splitSocketHost("postgres://u:p@/f3_prod")).toThrow(
      /no host after '@'/,
    );
  });

  it("never puts the URL (credentials) in an error", () => {
    expect(() => splitSocketHost("postgres://u:secret@/f3_prod")).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secret") as string,
      }),
    );
  });
});

describe("postgresArgs", () => {
  it("passes a socket as the options-form host", () => {
    expect(postgresArgs(`postgres://u:p@/f3_prod?host=${SOCKET}`)).toEqual({
      url: "postgres://u:p@localhost/f3_prod",
      hostOptions: { host: SOCKET },
    });
  });

  it("adds no host option for TCP", () => {
    expect(postgresArgs("postgres://u:p@localhost/f3nation")).toEqual({
      url: "postgres://u:p@localhost/f3nation",
      hostOptions: {},
    });
  });
});

describe("migrationsDatabaseName", () => {
  it("names the same table for the socket and TCP forms of a URL", () => {
    expect(
      migrationsDatabaseName(`postgres://u:p@/f3_prod?host=${SOCKET}`),
    ).toBe("f3_prod");
    expect(migrationsDatabaseName("postgres://u:p@10.0.0.5/f3_prod")).toBe(
      "f3_prod",
    );
  });

  it("keeps other parameters, as the legacy table names do", () => {
    expect(
      migrationsDatabaseName(
        `postgres://u:p@/f3_prod?host=${SOCKET}&sslmode=disable`,
      ),
    ).toBe("f3_prod?sslmode=disable");
  });
});

describe("getDatabaseNameFromUri", () => {
  it("reads the database name without the query", () => {
    expect(getDatabaseNameFromUri("postgres://u:p@h/f3_prod?x=1")).toBe(
      "f3_prod",
    );
    expect(getDatabaseNameFromUri("not a url")).toBeUndefined();
  });
});

describe("poolOptions", () => {
  it("keeps socket connections open between bursts", () => {
    const { hostOptions } = postgresArgs(
      `postgres://u:p@/f3_prod?host=${SOCKET}`,
    );
    expect(poolOptions(hostOptions)).toMatchObject({
      host: SOCKET,
      max: 5,
      // Literal on purpose: a short socket timeout raises tail latency.
      idle_timeout: 600,
      prepare: false,
    });
  });

  it("keeps the short idle timeout through the pooler (TCP)", () => {
    const { hostOptions } = postgresArgs(
      "postgres://u:p@pooler.internal:6432/f3_prod",
    );
    expect(poolOptions(hostOptions)).toMatchObject({
      max: 5,
      idle_timeout: 20,
    });
    expect(poolOptions(hostOptions)).not.toHaveProperty("host");
  });
});
