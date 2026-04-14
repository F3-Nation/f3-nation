import { describe, expect, it, vi } from "vitest";

import type { F3RegionPage } from "./f3-region-pages-client";
import { F3RegionPagesUnavailableError } from "./f3-region-pages-client";
import type { PaxVaultRegion } from "./pax-vault-client";
import { PaxVaultUnavailableError } from "./pax-vault-client";
import type {
  LoadOrgFactsResult,
  ValidatorQuery,
} from "./region-binding-validator-service";
import { runRegionBindingValidator } from "./region-binding-validator-service";

// We don't need a real AppDb — the stubbed loadOrgFacts never touches it.
const stubDb = {} as unknown as Parameters<
  typeof runRegionBindingValidator
>[1]["db"];

const goodQuery = (): ValidatorQuery => ({
  orgId: 123,
  paxVaultRegionId: "35838",
  regionSlug: "muletown",
  callingUserId: 7,
});

const goodOrgFacts = (): LoadOrgFactsResult => ({
  org: {
    id: 123,
    name: "F3 Muletown",
    last_modified: "2025-12-01T00:00:00.000Z",
  },
  admin_count: 4,
  caller_roles: ["admin"],
});

const goodPaxVault = (): PaxVaultRegion => ({
  region_id: "35838",
  region_name: "F3 Muletown",
  pax_count: 142,
  most_recent_beatdown: "2026-04-13",
  thumbnail_url:
    "https://pax-vault.f3nation.com/api/regions/35838/thumbnail.png",
});

const goodF3RegionPage = (): F3RegionPage => ({
  slug: "muletown",
  point_of_contact: "Slider",
  page_url: "https://regions.f3nation.com/muletown",
});

describe("runRegionBindingValidator", () => {
  it("returns ok with the full response body when all three sources agree", async () => {
    const fixedNow = new Date("2026-04-14T18:23:00.000Z");
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(goodOrgFacts()),
      fetchPaxVault: vi.fn().mockResolvedValue(goodPaxVault()),
      fetchF3RegionPage: vi.fn().mockResolvedValue(goodF3RegionPage()),
      now: () => fixedNow,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.body.org.id).toBe(123);
    expect(outcome.body.org.name).toBe("F3 Muletown");
    expect(outcome.body.org.admin_count).toBe(4);
    expect(outcome.body.org.caller_roles).toEqual(["admin"]);
    expect(outcome.body.pax_vault.region_id).toBe("35838");
    expect(outcome.body.f3_region_pages.slug).toBe("muletown");
    expect(outcome.body.cross_check.triple_matches).toBe(true);
    expect(outcome.body.cross_check.match_strategy).toBe("exact");
    expect(outcome.body.validated_at).toBe("2026-04-14T18:23:00.000Z");
  });

  it("returns org_not_found when loadOrgFacts resolves to null", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(null),
      fetchPaxVault: vi.fn(),
      fetchF3RegionPage: vi.fn(),
    });
    expect(outcome.kind).toBe("org_not_found");
  });

  it("returns forbidden when caller has no binding-capable roles on the org", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi
        .fn()
        .mockResolvedValue({ ...goodOrgFacts(), caller_roles: [] }),
      fetchPaxVault: vi.fn(),
      fetchF3RegionPage: vi.fn(),
    });
    expect(outcome.kind).toBe("forbidden");
    if (outcome.kind === "forbidden") {
      expect(outcome.reason).toBe("caller_not_authorized_on_org");
    }
  });

  it("returns source_unavailable pax_vault when pax-vault throws", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(goodOrgFacts()),
      fetchPaxVault: vi
        .fn()
        .mockRejectedValue(new PaxVaultUnavailableError("boom")),
      fetchF3RegionPage: vi.fn().mockResolvedValue(goodF3RegionPage()),
    });
    expect(outcome.kind).toBe("source_unavailable");
    if (outcome.kind === "source_unavailable") {
      expect(outcome.source).toBe("pax_vault");
    }
  });

  it("returns source_unavailable f3_region_pages when f3-region-pages throws", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(goodOrgFacts()),
      fetchPaxVault: vi.fn().mockResolvedValue(goodPaxVault()),
      fetchF3RegionPage: vi
        .fn()
        .mockRejectedValue(new F3RegionPagesUnavailableError("down")),
    });
    expect(outcome.kind).toBe("source_unavailable");
    if (outcome.kind === "source_unavailable") {
      expect(outcome.source).toBe("f3_region_pages");
    }
  });

  it("prioritizes pax_vault failure over f3_region_pages failure", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(goodOrgFacts()),
      fetchPaxVault: vi
        .fn()
        .mockRejectedValue(new PaxVaultUnavailableError("pv-down")),
      fetchF3RegionPage: vi
        .fn()
        .mockRejectedValue(new F3RegionPagesUnavailableError("rp-down")),
    });
    expect(outcome.kind).toBe("source_unavailable");
    if (outcome.kind === "source_unavailable") {
      expect(outcome.source).toBe("pax_vault");
    }
  });

  it("returns mismatch when triangulation fails", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue(goodOrgFacts()),
      fetchPaxVault: vi
        .fn()
        .mockResolvedValue({ ...goodPaxVault(), region_name: "Nope" }),
      fetchF3RegionPage: vi.fn().mockResolvedValue(goodF3RegionPage()),
    });
    expect(outcome.kind).toBe("mismatch");
    if (outcome.kind === "mismatch") {
      expect(outcome.detail.mismatches).toHaveLength(1);
      expect(outcome.detail.mismatches[0]?.field).toBe(
        "org_name_vs_pax_vault_region_name",
      );
    }
  });

  it("accepts fuzzy-matched org.name vs pax_vault.region_name and reports match_strategy=fuzzy", async () => {
    const outcome = await runRegionBindingValidator(goodQuery(), {
      db: stubDb,
      loadOrgFacts: vi.fn().mockResolvedValue({
        ...goodOrgFacts(),
        org: {
          ...goodOrgFacts().org,
          name: "  f3  muletown  ",
        },
      }),
      fetchPaxVault: vi.fn().mockResolvedValue(goodPaxVault()),
      fetchF3RegionPage: vi.fn().mockResolvedValue(goodF3RegionPage()),
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.body.cross_check.match_strategy).toBe("fuzzy");
    }
  });
});
