import { describe, it, expect, vi } from "vitest";

import {
  CallerNotAuthorizedError,
  OrgNotFoundError,
  TripleMismatchError,
  ValidatorClient,
  ValidatorUnavailableError,
} from "../validator-client";

function buildJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ValidatorClient", () => {
  const baseConfig = {
    baseUrl: "http://validator.test",
    s2sSecret: "shhh",
  };

  it("returns parsed body on 200", async () => {
    const body = {
      org: {
        id: 1,
        name: "F3 Muletown",
        last_modified: "2026-04-14T00:00:00.000Z",
        admin_count: 3,
        caller_roles: ["admin"],
      },
      pax_vault: { region_id: "pv-123", region_name: "F3 Muletown" },
      f3_region_pages: { slug: "muletown" },
      cross_check: { triple_matches: true, match_strategy: "exact" },
      validated_at: "2026-04-14T00:00:01.000Z",
    };
    const fetchImpl = vi.fn().mockResolvedValue(buildJsonResponse(200, body));
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });

    const result = await client.validate({
      orgId: 1,
      paxVaultRegionId: "pv-123",
      regionSlug: "muletown",
      callingUserId: 99,
    });

    expect(result).toEqual(body);
    const firstCall = fetchImpl.mock.calls[0] as unknown as
      | [string, { headers: Record<string, string> }]
      | undefined;
    expect(firstCall).toBeDefined();
    const calledUrl = firstCall?.[0] ?? "";
    expect(calledUrl).toContain("org_id=1");
    expect(calledUrl).toContain("pax_vault_region_id=pv-123");
    expect(calledUrl).toContain("region_slug=muletown");
    expect(calledUrl).toContain("calling_user_id=99");
    expect(firstCall?.[1].headers.Authorization).toBe("Bearer shhh");
  });

  it("throws OrgNotFoundError on 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(buildJsonResponse(404, { error: "org_not_found" }));
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });
    await expect(
      client.validate({
        orgId: 77,
        paxVaultRegionId: "pv-x",
        regionSlug: "nope",
        callingUserId: 1,
      }),
    ).rejects.toBeInstanceOf(OrgNotFoundError);
  });

  it("throws CallerNotAuthorizedError on 403", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        buildJsonResponse(403, { error: "caller_not_authorized_on_org" }),
      );
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });
    await expect(
      client.validate({
        orgId: 1,
        paxVaultRegionId: "p",
        regionSlug: "s",
        callingUserId: 1,
      }),
    ).rejects.toBeInstanceOf(CallerNotAuthorizedError);
  });

  it("throws TripleMismatchError on 422 with structured detail", async () => {
    const mismatches = [
      {
        field: "region_slug",
        sources: { query_param: "foo", f3_region_pages: "bar" },
        reason: "slug mismatch",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(
      buildJsonResponse(422, {
        error: "triple_mismatch",
        detail: { mismatches },
      }),
    );
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });
    try {
      await client.validate({
        orgId: 1,
        paxVaultRegionId: "p",
        regionSlug: "s",
        callingUserId: 1,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TripleMismatchError);
      expect((err as TripleMismatchError).mismatches).toEqual(mismatches);
    }
  });

  it("throws ValidatorUnavailableError on 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        buildJsonResponse(503, { error: "source_unavailable" }),
      );
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });
    await expect(
      client.validate({
        orgId: 1,
        paxVaultRegionId: "p",
        regionSlug: "s",
        callingUserId: 1,
      }),
    ).rejects.toBeInstanceOf(ValidatorUnavailableError);
  });

  it("throws ValidatorUnavailableError when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ValidatorClient({ ...baseConfig, fetchImpl });
    await expect(
      client.validate({
        orgId: 1,
        paxVaultRegionId: "p",
        regionSlug: "s",
        callingUserId: 1,
      }),
    ).rejects.toBeInstanceOf(ValidatorUnavailableError);
  });
});
