/** Supported org.all sort keys, shared by API mappings and admin configuration. */
export const ORG_ALL_SORT_IDS = [
  "id",
  "name",
  "parentOrgName",
  "sectorName",
  "territoryName",
  "aoCount",
  "lastAnnualReview",
  "status",
  "created",
] as const;

export type OrgAllSortId = (typeof ORG_ALL_SORT_IDS)[number];
