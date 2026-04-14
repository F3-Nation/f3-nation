/**
 * Pure triangulation logic for the internal region-binding validator
 * (R5 Decision 11). Has no I/O — takes three normalized data points and
 * returns a match verdict plus (on failure) a structured detail object.
 *
 * Keep this file dependency-free so unit tests can exercise every branch
 * without mocking databases or network clients.
 */

export interface OrgFacts {
  id: number;
  name: string;
}

export interface PaxVaultFacts {
  region_id: string;
  region_name: string;
}

export interface F3RegionPagesFacts {
  slug: string;
}

export interface TriangulationInput {
  org: OrgFacts;
  paxVault: PaxVaultFacts;
  f3RegionPages: F3RegionPagesFacts;
  /** The caller-provided region slug — the exact ground truth we compare against. */
  requestedRegionSlug: string;
  /** The caller-provided pax-vault region id claim — must match the response. */
  requestedPaxVaultRegionId: string;
}

export type MatchStrategy = "exact" | "fuzzy" | "failed";

export interface TriangulationMismatchDetail {
  /** Which logical comparison failed. */
  field:
    | "org_name_vs_pax_vault_region_name"
    | "region_slug"
    | "pax_vault_region_id";
  /** Which source held which value. */
  sources: Record<string, string>;
  reason: string;
}

export interface TriangulationResult {
  triple_matches: boolean;
  match_strategy: MatchStrategy;
  mismatches: TriangulationMismatchDetail[];
}

/** Lowercase + trim. Used for fuzzy comparisons. */
export const normalizeLoose = (value: string): string =>
  value.trim().toLowerCase();

/** Collapse all interior whitespace to a single space after trim+lowercase. */
export const normalizeAggressive = (value: string): string =>
  normalizeLoose(value).replace(/\s+/g, " ");

export const triangulate = (input: TriangulationInput): TriangulationResult => {
  const mismatches: TriangulationMismatchDetail[] = [];

  // 1. pax-vault region id must equal the caller's claim exactly (it's an
  //    opaque identifier, not a display string — no fuzzy match allowed).
  if (input.paxVault.region_id !== input.requestedPaxVaultRegionId) {
    mismatches.push({
      field: "pax_vault_region_id",
      sources: {
        query_param: input.requestedPaxVaultRegionId,
        pax_vault_response: input.paxVault.region_id,
      },
      reason: "pax-vault returned a different region id than requested",
    });
  }

  // 2. f3-region-pages slug must equal the caller's claim exactly.
  //    Slugs are canonical, case-sensitive identifiers.
  if (input.f3RegionPages.slug !== input.requestedRegionSlug) {
    mismatches.push({
      field: "region_slug",
      sources: {
        query_param: input.requestedRegionSlug,
        f3_region_pages_response: input.f3RegionPages.slug,
      },
      reason: "f3-region-pages returned a different slug than requested",
    });
  }

  // 3. org.name vs pax_vault.region_name — display strings. We allow
  //    exact match first, then fall back to a normalized (case-insensitive,
  //    whitespace-collapsed) comparison, which bumps match_strategy to "fuzzy".
  const nameExact = input.org.name === input.paxVault.region_name;
  const nameFuzzy =
    normalizeAggressive(input.org.name) ===
    normalizeAggressive(input.paxVault.region_name);

  let nameStrategy: MatchStrategy = "exact";
  if (!nameExact) {
    if (nameFuzzy) {
      nameStrategy = "fuzzy";
    } else {
      nameStrategy = "failed";
      mismatches.push({
        field: "org_name_vs_pax_vault_region_name",
        sources: {
          org_name: input.org.name,
          pax_vault_region_name: input.paxVault.region_name,
        },
        reason:
          "org.name and pax_vault.region_name disagree even after case-insensitive, whitespace-normalized comparison",
      });
    }
  }

  if (mismatches.length > 0) {
    return {
      triple_matches: false,
      match_strategy: "failed",
      mismatches,
    };
  }

  return {
    triple_matches: true,
    match_strategy: nameStrategy === "fuzzy" ? "fuzzy" : "exact",
    mismatches: [],
  };
};
