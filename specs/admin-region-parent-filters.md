# Region parents and ancestry filters

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

Administrators can create and edit a Region beneath either an Area or a Territory,
so a Territory does not need an unnecessary Area. The Regions table offers optional
Sector, Territory, and Area filters that follow actual ancestry, including a
Territory containing both direct Regions and Areas with their own Regions.

## 2. Context & links

- [Issue #1172](https://github.com/F3-Nation/f3-nation/issues/1172); related
  [Territory epic #855](https://github.com/F3-Nation/f3-nation/issues/855).
- App affected: admin. Existing API authorization and database AO-count behavior
  are verified by regression tests without changing their contracts.
- Builds on [Territory administration](admin-territory-management.md) and
  [generic organization management](admin-generic-org-management.md). This spec
  governs Region parent choices and hierarchy filters where the older specs
  describe Area-only parents or Sector/Area-only Region filters.
- The backend parent-type rule already permits Territory parents for Regions.
  Admin resolves ancestry selections to immediate `parentOrgIds` for the existing
  `org.all` API, whose filtering and totals run before pagination. An empty ID list
  is unfiltered; the existing explicit no-match sentinel must be preserved.
- Key code:
  - `apps/admin/src/app/_components/modal/{org-editor-config,admin-org-edit-modal}`
  - `apps/admin/src/app/_components/org/{org-admin-config,org-ancestry,use-org-filters,org-table}`
  - `apps/admin/src/utils/hooks/use-fetch-all-pages.ts`
  - `packages/api/src/{router/org,check-has-role-on-org}.ts`
  - `packages/shared/src/app/org-hierarchy.ts`
  - Existing depth-agnostic AO-count functions in `packages/db/drizzle/`.
- [Issue #1040](https://github.com/F3-Nation/f3-nation/issues/1040) tracks the
  broader tier-agnostic filter refactor; it is not a prerequisite for this feature.

## 3. User stories

- As a Region editor, I want to select an Area or Territory parent so that my
  Region follows the hierarchy chosen by its leadership.
- As an administrator, I want a Territory filter to show both direct Regions and
  Regions beneath Areas so that an optional Area never hides part of a Territory.
- As an administrator, I want independent hierarchy filters with predictable
  intersections so that I can find Regions during a gradual Territory rollout.

## 4. Acceptance criteria (testable, non-contradictory)

### Region editor

- **AC-1** — GIVEN the Region create or edit dialog WHEN parent choices load THEN
  its parent selector is labeled "Area or Territory" and offers Areas and
  Territories in groups sorted by name. It does not newly offer Sectors or Nations.
- **AC-2** — GIVEN an existing Region with an Area or Territory parent WHEN its
  editor loads THEN that parent remains selected, including an inactive current
  parent, and saving without changing it submits the same parent. Other selectable
  parents are active; inactive organizations do not become new parent choices.
- **AC-3** — GIVEN an authorized editor WHEN a Region is created under either
  parent type or moved between Area and Territory in either direction THEN the
  saved parent persists and remains selected on reopening. Existing Region fields,
  logo, metadata, validation, success/error handling, and create/save flow remain
  unchanged.
- **AC-4** — GIVEN a Region directly beneath a Territory WHEN its row is shown
  THEN its Area is blank and its Sector is resolved through the Territory. The
  Region table retains its Area and Sector columns and existing sorting behavior.

### Hierarchy filters

- **AC-5** — GIVEN the Regions table on desktop or mobile WHEN its filters are
  opened THEN Sector, Territory, and Area filters are available, and each can be
  used without first selecting another hierarchy tier.
- **AC-6** — GIVEN a selected Sector WHEN Regions are requested THEN all matching
  Region branches beneath it are included, including `Sector → Area → Region`,
  `Sector → Territory → Region`, and `Sector → Territory → Area → Region`.
- **AC-7** — GIVEN a selected Territory containing direct Regions and Areas with
  Regions WHEN results load THEN both branches are included.
- **AC-8** — GIVEN a selected Area WHEN results load THEN only Regions with that
  Area in their ancestry are included. A direct Territory-parented Region without
  that Area is excluded even when the Territory is also selected.
- **AC-9** — GIVEN multiple selections WHEN matching Region ancestry THEN
  selections within a tier use OR and all nonempty selected tiers combine with
  AND. With no hierarchy selections, otherwise eligible Regions are unfiltered
  by parent.
- **AC-10** — GIVEN retained Territory and Area selections with no intersecting
  ancestry WHEN querying Regions THEN zero rows and a zero matching total are
  returned, without falling back to an unfiltered query.
- **AC-11** — GIVEN an inactive intermediate Area or Territory WHEN matching a
  selected Sector or Territory THEN that ancestor remains in the traversal and
  eligible descendant Regions are included. Filter choices remain active-only;
  Region status and authorization filters still determine eligible rows.
- **AC-12** — GIVEN selected Territories or Areas WHEN Sector selections change
  THEN only lower-tier selections beneath the remaining selected Sectors are
  retained, following the existing Sector pruning behavior. Clearing the last
  Sector preserves otherwise available lower-tier selections.
- **AC-13** — GIVEN Territory and Area selections WHEN either changes THEN they
  do not narrow or prune each other's choices or selections. Incompatible retained
  selections produce the empty intersection in AC-10.
- **AC-14** — GIVEN a hierarchy refetch WHEN a selected organization becomes
  inactive or moves outside the selected Sector scope THEN existing reconciliation
  removes that selection, and clearing a Sector later does not restore it.
- **AC-15** — GIVEN a hierarchy spanning multiple API pages WHEN filtering Regions
  THEN all hierarchy pages and inactive ancestors participate in matching, rather
  than only the loaded Region page or first hierarchy page. Parent filtering occurs
  on the server before Region pagination, and returned totals reflect the filters.
- **AC-16** — GIVEN an existing hierarchy selection WHEN hierarchy data is
  temporarily unavailable or a selected subtree has no matching parents THEN
  selections do not silently disappear during loading and the query does not
  broaden to all Regions. Preserve cycle and missing-ancestor termination.
- **AC-17** — GIVEN a changed hierarchy selection WHEN its query is issued THEN
  pagination resets to the first page. Search, Status, Only Mine, page-size choices,
  sorting, selection clearing, and Reset Filters retain their existing behavior.

### Persistence, counts, and inherited permissions

- **AC-18** — GIVEN a Territory with direct Regions and Regions beneath Areas
  WHEN active AOs change or a Region moves between an Area and Territory THEN
  existing AO counts remain correct for both branches and both the old and new
  ancestor chains, including across Sectors. Existing inactive-intermediate counting
  rules remain unchanged.
- **AC-19** — GIVEN roles on a Territory or Area WHEN a Region is created or moved
  beneath it THEN inherited access to the Region and its AO descendants follows
  actual parent links. After a move, roles inherited only from the old ancestry no
  longer grant access, and roles on the new ancestry do.
- **AC-20** — GIVEN a proposed Region move WHEN the caller lacks editor access to
  the source Region or destination parent THEN the existing API rejects the move
  and persisted parent and AO counts remain unchanged. An otherwise valid move
  with both permissions succeeds.
- **AC-21** — GIVEN other organization tables/editors WHEN used after this change
  THEN their parent choices, filters, columns, authorization, and save behavior
  remain unchanged. Every Region parent choice remains accepted by the existing
  server parent-type rule.

## 5. Roles & authorization (RBAC)

The current API procedures and resource checks remain authoritative. An offered
parent or filter option does not grant access, and filtering does not change the
meaning of Only Mine or inherited roles.

| Action                                     | Allowed                                                                             | Explicitly denied                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| List/read Regions and hierarchy            | Existing `protectedProcedure` callers under current query scoping                   | Unauthenticated callers                                                  |
| Create a Region under an Area or Territory | `editorProcedure` caller passing the existing editor check on the parent            | Callers lacking the procedure role or scoped parent access               |
| Edit an existing Region                    | `editorProcedure` caller passing the editor check on the Region                     | Callers without target Region access, even if they have a role elsewhere |
| Change a Region's parent                   | Editor access to the source Region and destination parent, with a valid parent type | Callers lacking either resource check or choosing an invalid parent      |
| Deactivate through the dedicated action    | Existing `adminProcedure` and target-org admin check                                | Editor-only callers and administrators without target-org access         |

Territory roles inherit through either branch shape using the existing recursive
role checks. This feature adds no role, changes no procedure tier, and does not
alter authorization inheritance or API-key behavior.

## 6. Out of scope / non-goals

- A Territory column on the Regions table, new sorting behavior, or additional
  Region editor parent types beyond Area and Territory.
- The broader generic filter refactor in #1040, bulk reparenting, or rollout tooling.
- New API endpoints, schema migrations, AO-count function changes, RBAC changes,
  production/staging data changes, or automatic deployment.
- Changes to other organization types' inactive-parent or filter behavior.

## 7. Critical-path test cases

- Region create/edit with grouped Area/Territory choices, unchanged saves,
  inactive current parent, both move directions, and preserved Region fields.
- Mixed branches with standalone and combined Sector/Territory/Area selections,
  OR within a tier, AND across tiers, and retained incompatible selections.
- Active-only choices with inactive matching ancestors; Sector pruning, refetch
  reconciliation, loading/empty matches, cycles, and missing ancestors.
- Off-first-page hierarchy matching, server pagination/totals, page resets, and
  desktop/mobile filter controls.
- Real local API persistence, mixed AO counts, both moved ancestor chains,
  inherited permissions, and denied moves with no persisted change.

Run focused regressions, browser verification for the changed flows, and
`pnpm ci:local` before declaring the change ready. Use synthetic fixtures and
local or mocked services for verification.

## 8. Observability

- Preserve existing success/error toasts and structured API logging. No new
  application events or metrics are required for this feature.
- Any necessary diagnostics use `@acme/logger` and exclude form values,
  credentials, and personal data.
