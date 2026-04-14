import { describe, expect, it } from "vitest";

import {
  normalizeAggressive,
  normalizeLoose,
  triangulate,
} from "./region-binding-triangulator";
import type { TriangulationInput } from "./region-binding-triangulator";

const baseInput = (): TriangulationInput => ({
  org: { id: 123, name: "F3 Muletown" },
  paxVault: { region_id: "35838", region_name: "F3 Muletown" },
  f3RegionPages: { slug: "muletown" },
  requestedRegionSlug: "muletown",
  requestedPaxVaultRegionId: "35838",
});

describe("normalizeLoose", () => {
  it("trims and lowercases", () => {
    expect(normalizeLoose("  F3 Muletown  ")).toBe("f3 muletown");
  });
});

describe("normalizeAggressive", () => {
  it("collapses interior whitespace", () => {
    expect(normalizeAggressive("  F3   Muletown\tRegion ")).toBe(
      "f3 muletown region",
    );
  });
});

describe("triangulate", () => {
  it("returns exact match when all three sources agree exactly", () => {
    const result = triangulate(baseInput());
    expect(result.triple_matches).toBe(true);
    expect(result.match_strategy).toBe("exact");
    expect(result.mismatches).toEqual([]);
  });

  it("returns fuzzy match when org name differs only in case/whitespace", () => {
    const input = baseInput();
    input.org.name = "  f3  muletown ";
    const result = triangulate(input);
    expect(result.triple_matches).toBe(true);
    expect(result.match_strategy).toBe("fuzzy");
    expect(result.mismatches).toEqual([]);
  });

  it("fails when pax_vault_region_id disagrees with query param", () => {
    const input = baseInput();
    input.paxVault.region_id = "99999";
    const result = triangulate(input);
    expect(result.triple_matches).toBe(false);
    expect(result.match_strategy).toBe("failed");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.field).toBe("pax_vault_region_id");
  });

  it("fails when region_slug from f3-region-pages disagrees with query param", () => {
    const input = baseInput();
    input.f3RegionPages.slug = "someother";
    const result = triangulate(input);
    expect(result.triple_matches).toBe(false);
    expect(result.match_strategy).toBe("failed");
    expect(result.mismatches[0]?.field).toBe("region_slug");
  });

  it("fails when org.name and pax_vault.region_name cannot be reconciled even fuzzily", () => {
    const input = baseInput();
    input.paxVault.region_name = "F3 SomewhereElse";
    const result = triangulate(input);
    expect(result.triple_matches).toBe(false);
    expect(result.match_strategy).toBe("failed");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.field).toBe(
      "org_name_vs_pax_vault_region_name",
    );
  });

  it("returns all mismatches when multiple sources disagree", () => {
    const input = baseInput();
    input.paxVault.region_id = "11111";
    input.f3RegionPages.slug = "nope";
    input.paxVault.region_name = "Nope";
    const result = triangulate(input);
    expect(result.triple_matches).toBe(false);
    expect(result.match_strategy).toBe("failed");
    // Three mismatches: pax_vault_region_id, region_slug, org_name_vs_pax_vault_region_name.
    expect(result.mismatches).toHaveLength(3);
    const fields = result.mismatches.map((m) => m.field).sort();
    expect(fields).toEqual(
      [
        "org_name_vs_pax_vault_region_name",
        "pax_vault_region_id",
        "region_slug",
      ].sort(),
    );
  });

  it("includes the raw source values in the mismatch detail for debugging", () => {
    const input = baseInput();
    input.paxVault.region_name = "Totally Different";
    const result = triangulate(input);
    expect(result.mismatches[0]?.sources).toEqual({
      org_name: "F3 Muletown",
      pax_vault_region_name: "Totally Different",
    });
  });
});
