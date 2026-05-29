import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dnsInstructions } from "./domains";

// The DNS-instruction rules live in BOTH TypeScript (here) and Go
// (internal/mappings). This asserts the TS implementation matches the shared
// contract in ../testdata/dns-instructions.json; the Go suite asserts the same
// file. If either drifts, one suite goes red.

interface Rec {
  type: string;
  name: string;
  value: string;
  optional: boolean;
}
interface Case {
  name: string;
  host: string;
  options: { staticIP: string; canonicalHost: string };
  records: Rec[];
}

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "..", "shared", "dns-instructions.json"),
    "utf8",
  ),
) as { cases: Case[] };

function norm(
  recs: { type: string; name: string; value: string; optional: boolean }[],
): Rec[] {
  return recs
    .map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
      optional: r.optional,
    }))
    .sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type.localeCompare(b.type),
    );
}

describe("DNS instruction parity (shared contract with the Go tier)", () => {
  it("fixture has cases", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const got = dnsInstructions(c.host, {
        staticIP: c.options.staticIP,
        canonicalHost: c.options.canonicalHost,
      });
      expect(norm(got)).toEqual(norm(c.records));
    });
  }
});
