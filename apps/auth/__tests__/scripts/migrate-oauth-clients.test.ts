import { describe, expect, it } from "vitest";

import {
  buildClientRow,
  planMigration,
} from "../../scripts/migrate-oauth-clients-to-better-auth";
import { F3_NATION_CLIENT_REFERENCE_ID } from "../../src/lib/oauth-client-reference";

const legacy = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "client-1",
    name: "Client One",
    isPublic: false,
    isActive: true,
    redirectUris: JSON.stringify(["https://app.example/callback"]),
    scopes: "openid profile",
    ...overrides,
  }) as Parameters<typeof buildClientRow>[0];

const NOW = new Date("2026-01-01T00:00:00Z");

describe("buildClientRow", () => {
  it("migrates a confidential client disabled, with no secret, and client_secret_post", () => {
    const row = buildClientRow(legacy(), NOW);
    expect(row).toMatchObject({
      clientId: "client-1",
      clientSecret: null,
      disabled: true,
      tokenEndpointAuthMethod: "client_secret_post",
      applicationType: "web",
      referenceId: F3_NATION_CLIENT_REFERENCE_ID,
      requirePKCE: true,
      skipConsent: true,
    });
  });

  it("migrates a public client active, with no auth method", () => {
    const row = buildClientRow(legacy({ isPublic: true }), NOW);
    expect(row).toMatchObject({
      disabled: false,
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
    });
  });

  it("adds offline_access once, and defaults an empty scope string", () => {
    expect(buildClientRow(legacy(), NOW).scopes).toEqual([
      "openid",
      "profile",
      "offline_access",
    ]);
    expect(
      buildClientRow(legacy({ scopes: "openid offline_access" }), NOW).scopes,
    ).toEqual(["openid", "offline_access"]);
    expect(buildClientRow(legacy({ scopes: "  " }), NOW).scopes).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
    ]);
  });

  it.each(["not json", '{"a":1}', "[1,2]"])(
    "refuses malformed redirect_uris %s",
    (redirectUris) => {
      expect(() => buildClientRow(legacy({ redirectUris }), NOW)).toThrow(
        /redirect_uris for "client-1"/,
      );
    },
  );
});

describe("planMigration", () => {
  const existing = (clientId: string, owner: object = {}) => ({
    clientId,
    referenceId: null,
    userId: null,
    skipConsent: true,
    tokenEndpointAuthMethod: "client_secret_post",
    scopes: ["offline_access"],
    ...owner,
  });
  const rowsFor = (...ids: string[]) =>
    ids.map((id) => buildClientRow(legacy({ id }), NOW));

  it("inserts clients that aren't there and links them", () => {
    const plan = planMigration({
      rows: rowsFor("a", "b"),
      alreadyPresent: [],
      linkedClientIds: new Set(),
    });
    expect(plan.newRows.map((r) => r.clientId)).toEqual(["a", "b"]);
    expect(plan.toLink.map((r) => r.clientId)).toEqual(["a", "b"]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.needsReview).toEqual([]);
  });

  it("stamps an ownerless existing row but never one pinned to a user or another reference", () => {
    const plan = planMigration({
      rows: rowsFor("none", "user", "other", "mine"),
      alreadyPresent: [
        existing("none"),
        existing("user", { userId: "u1" }),
        existing("other", { referenceId: "someone-else" }),
        existing("mine", { referenceId: F3_NATION_CLIENT_REFERENCE_ID }),
      ],
      linkedClientIds: new Set(),
    });
    expect(plan.newRows).toEqual([]);
    expect(plan.toStamp.map((r) => r.clientId)).toEqual(["none"]);
    expect(plan.needsReview.map((r) => r.clientId)).toEqual(["user", "other"]);
  });

  it("never links a row held back for review, nor one already linked", () => {
    const plan = planMigration({
      rows: rowsFor("review", "linked", "fresh"),
      alreadyPresent: [existing("review", { userId: "u1" })],
      linkedClientIds: new Set(["linked"]),
    });
    expect(plan.toLink.map((r) => r.clientId)).toEqual(["fresh"]);
  });
});
