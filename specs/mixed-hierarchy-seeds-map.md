# Mixed hierarchy seeds and map verification

> Human designer: Michael (@michaeldpotter); approach and scope approved in
> conversation on September 18, 2026.

## 1. Summary

Exercise the Territory hierarchy with real mixed-parent fixtures and local seed
data, preserving existing fixtures while proving map queries and browsing work
through both paths.

## 2. Context & links

- Issue: [#929](https://github.com/F3-Nation/f3-nation/issues/929), epic #855.
- #923 introduced Territory. #924 owns AO counting and enabling Area parenting
  beneath Territory through the API/admin UI. Direct database fixture insertion
  does not require removing that temporary rollout gate.
- Affected: `packages/db`, `packages/api`, shared test constants, and `apps/map`
  verification. Existing traversal/depth-limit tests remain useful independently
  of real organization-type fixtures.

## 3. User stories

- As a contributor, I can seed both hierarchy shapes without changing existing
  fixture identities or duplicating existing branches on a repeat seed.
- As a map user, I can find workouts below a Territory and below a direct
  Sector/Area branch, with the same filtering and detail behavior.

## 4. Acceptance criteria

- **AC-1** — The test seed and local development seed each contain a complete
  Nation → Sector → Territory → Area → Region → AO path and a complete
  Nation → Sector → Area → Region → AO path. Existing IDs and parent links
  remain unchanged; new organizations use additive identities.
- **AC-2** — Re-running the local seed does not duplicate either branch.
  Local seeded workouts retain the existing Monday morning conventions used
  by map browser tests. Metadata used to resolve seed parents is not passed
  as database columns.
- **AC-3** — API testing helpers can create mixed trees for multiple suites.
  Real Territory tests prove ancestor authorization, editable non-AO scope,
  and descendant lookup reaching AOs, alongside existing synthetic depth and
  cycle tests. Test helpers derive organization types from shared `OrgType`.
- **AC-4** — `map.event.all` with `onlyMine` includes both branches for a
  Sector-scoped principal, includes only the Territory branch for a
  Territory-scoped principal, and excludes unrelated workouts. These cases
  use database-backed roles rather than the nation-role bypass.
- **AC-5** — Map location queries retain an active Territory branch and exclude
  its workout when the Territory ancestor becomes inactive, without hiding
  the active direct-Area branch.
- **AC-6** — Browser verification against the local mixed seed demonstrates
  loading, region search, workout filtering, and workout details for the new
  branch, plus continued visibility of the legacy branch. Record evidence and
  any limitations separately from automated test results.
- **AC-7** — Audit actual map callers for hierarchy assumptions; preserve
  intentional AO-under-Region behavior. Required formatting, lint, unused-code,
  typecheck, build, and test gates pass before declaring implementation ready.

## 5. Roles & authorization

No authorization behavior changes. Existing public map visibility filters and
protected map-event procedure tiers remain in place.

| Action                                      | Allowed                                                                | Explicitly denied                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Browse published map workouts               | Existing public map callers with visible workouts                      | Inactive/private workouts under existing visibility rules                              |
| Receive `onlyMine` event results            | Existing authenticated callers with database-backed editor/admin scope | Workouts outside the caller's scope; callers without editable scope receive no results |
| Create Area under Territory through the API | Remains gated pending #924                                             | Rejected by the existing temporary guard                                               |

## 6. Out of scope / non-goals

- #924's trigger/recount rewrite, admin parent selector, and parenting-guard
  removal. The reachable recount in `seed.ts` remains explicitly #924-owned;
  mixed seed data is not evidence of correct Sector/Territory AO counts.
- Production seed execution, data reparenting, recounting, or deployment.
- New schema migrations, authorization changes, or broad map UI refactors.
- Reviving historical inactive insertion functions in `seed.ts`.

## 7. Critical-path test cases

- Mixed-tree creation with both complete paths and stable legacy fixtures.
- Territory/Sector role scoping and unrelated-workout exclusion.
- Actual Territory ancestor activation/deactivation in map location results.
- Repeat local seed and browser search/filter/details across the mixed tree.

## 8. Observability

No new application events. Retain aggregate seed verification, test results,
browser evidence, and known #924 limitations without credentials or personal
data. Synthetic local seed names are not production organization mappings.
