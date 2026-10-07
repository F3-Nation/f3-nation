# Region parents and ancestry filters

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

Administrators can create and edit a Region beneath either an Area or a Territory,
so a Territory does not need an unnecessary Area. The Regions table offers optional
Sector, Territory, and Area filters that follow actual ancestry, including a
Territory containing both direct Regions and Areas with their own Regions.

## 2. Context

- During Territory rollout, some Territories need direct Region children rather
  than an intermediate Area. The Region editor supports both parent types, and
  ancestry filters must include both branch shapes.
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
- A broader tier-agnostic filter refactor is independent of this feature.

## 3. User stories

- As an administrator or editor with access to the Region and its destination
  parent, I want to select an Area or Territory parent so that the Region follows
  the hierarchy chosen by its leadership. Editor access only to the Region does
  not authorize moving it.
- As a Region editor without parent-level access, I want to edit Region details
  while retaining its current parent, without being offered unauthorized moves.
- As an administrator, I want a Territory filter to show both direct Regions and
  Regions beneath Areas so that an optional Area never hides part of a Territory.
- As an administrator, I want selecting a Territory to narrow Area choices to
  its Areas so that I can refine Region results within that Territory.

## 4. Acceptance criteria (testable, non-contradictory)

### Region editor

- **AC-1** — GIVEN the Region create or edit dialog WHEN parent choices load THEN
  its parent selector is labeled "Area or Territory" and offers Areas and
  Territories in groups sorted by name. It does not newly offer Sectors or Nations.
- **AC-2** — GIVEN an existing Region with an Area or Territory parent WHEN its
  editor loads THEN that parent remains selected, including an inactive current
  parent, and saving without changing it submits the same parent. Other selectable
  parents are active; inactive organizations do not become new parent choices.
- **AC-3** — GIVEN an editor or administrator with editor access to the parent
  for creation, or to both the Region and destination parent for a move, WHEN a
  Region is created under either parent type or moved between Area and Territory
  in either direction THEN the saved parent persists and remains selected on
  reopening. New parent choices are limited to active parents the caller can edit;
  the current parent remains displayed for unchanged saves. A caller whose only
  access is editor on the Region can edit its details but cannot change its parent.
  The parent selector is disabled until required permission data is available or
  when no authorized alternative exists, with an explanation of that state.
  Once the existing Region record is loaded, an unchanged-parent save remains
  available while the advisory permission lookup is loading or has failed; the
  API still checks access to the Region. Confirmed source-access denial or an
  unavailable Region record blocks saving. A move requires verified source access
  and a successfully loaded, active, authorized destination. Record and permission
  lookup failures are described as loading failures, separately from access denial;
  a failed parent-list refetch prevents a changed-parent save and explains the
  loading failure. If a parent change is already selected, a "Keep current parent"
  action restores the saved parent while preserving other unsaved details, even
  when advisory source-access or parent-choice queries fail. Existing Region
  fields, logo, metadata, validation, and API
  success/error handling remain unchanged.
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
- **AC-10** — GIVEN selected ancestry with no matching Regions WHEN querying
  Regions THEN zero rows and a zero matching total are returned, without falling
  back to an unfiltered query.
- **AC-11** — GIVEN an inactive intermediate Area or Territory WHEN matching a
  selected Sector or Territory THEN that ancestor remains in the traversal and
  eligible descendant Regions are included. Filter choices remain active-only;
  Region status and authorization filters still determine eligible rows.
- **AC-12** — GIVEN selected Territories or Areas WHEN Sector selections change
  THEN only lower-tier selections beneath the remaining selected Sectors are
  retained, following the existing Sector pruning behavior. Clearing the last
  Sector preserves otherwise available lower-tier selections.
- **AC-13** — GIVEN one or more selected Territories WHEN Area choices are shown
  THEN only active Areas beneath any selected Territory and within the selected
  Sector scope are offered. Changing Territories clears selected Areas outside
  that scope. Clearing the last Territory restores all active Areas within the
  Sector scope, without restoring cleared selections. Area selections do not
  narrow Territory choices. A Territory with no Areas offers no Area choices but
  still includes its direct Regions when no Area is selected.
- **AC-14** — GIVEN a hierarchy refetch WHEN a selected organization becomes
  inactive or moves outside the selected Sector or Territory scope THEN existing
  reconciliation removes that selection. Clearing an ancestor filter later does
  not restore it. Removing a selection resets pagination to the first page;
  a refetch that leaves selections unchanged preserves the current page.
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

| Action                                     | Allowed                                                                                                                   | Explicitly denied                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| List/read Regions and hierarchy            | Existing `protectedProcedure` callers under current query scoping                                                         | Unauthenticated callers                                                                  |
| Create a Region under an Area or Territory | `editorProcedure` caller passing the existing editor check on the parent                                                  | Callers lacking the procedure role or scoped parent access                               |
| Edit an existing Region                    | `editorProcedure` caller passing the editor check on the Region                                                           | Callers without target Region access, even if they have a role elsewhere                 |
| Change a Region's parent                   | Editor or admin access, directly or inherited, to both the source Region and destination parent, with a valid parent type | Region-only editors; callers lacking either resource check or choosing an invalid parent |
| Deactivate through the dedicated action    | Existing `adminProcedure` and target-org admin check                                                                      | Editor-only callers and administrators without target-org access                         |

Territory roles inherit through either branch shape using the existing recursive
role checks. This feature adds no role, changes no procedure tier, and does not
alter authorization inheritance or API-key behavior.

The existing parent-change rule accepts scoped editor or admin access; it does
not require the admin role specifically. A role on the Region does not inherit
upward to its Area or Territory. The Admin parent control reflects these resource
checks, while the API remains authoritative. An unchanged-parent save requires
access to the Region, without requiring access to its current parent.

## 6. Out of scope / non-goals

- A Territory column on the Regions table, new sorting behavior, or additional
  Region editor parent types beyond Area and Territory.
- The broader generic filter refactor, bulk reparenting, or rollout tooling.
- New API endpoints, schema migrations, AO-count function changes, RBAC changes,
  production/staging data changes, or automatic deployment.
- Changes to other organization types' inactive-parent or filter behavior.

## 7. Critical-path test cases

- Region create/edit with grouped Area/Territory choices, unchanged saves,
  inactive current parent, both move directions, and preserved Region fields.
- Mixed branches with standalone and combined Sector/Territory/Area selections,
  OR within a tier, AND across tiers, and explicit empty results.
- Territory-scoped Area choices, multiple selected Territories, pruning of
  incompatible Area selections, restoring choices when Territories clear, and
  direct Regions in Territories with no Areas; desktop and mobile controls.
- Active-only choices with inactive matching ancestors; Sector and Territory
  pruning, refetch reconciliation, loading/empty matches, cycles, and missing
  ancestors.
- Off-first-page hierarchy matching, server pagination/totals, page resets, and
  desktop/mobile filter controls.
- Real local API persistence, mixed AO counts, both moved ancestor chains,
  inherited permissions, and denied moves with no persisted change.
- A Region-only editor can save ordinary details with an unchanged parent;
  Area and Territory moves are rejected without changing the parent or AO counts.
- Parent-control permission loading/failure, authorized destination choices,
  Region-only disabled state, and active/inactive current-parent preservation.
- Loaded Region details remain saveable during an advisory permission lookup or
  failure, while parent moves stay blocked. Confirmed denial and a missing, loading,
  or failed Region record block saving. A failed parent-list refetch reports its
  loading failure without submitting a move or creation; an only-current-parent
  selector explains the lack of alternatives and permits an unchanged save.
- After a parent choice or advisory source-access refetch fails, "Keep current
  parent" restores only the saved parent and permits saving other edited details.
- A hierarchy refetch that reparents a selected Area resets a later Region page
  to the first page and shows remaining matching Regions; an unchanged hierarchy
  refetch preserves the current page.

Run focused regressions, browser verification for the changed flows, and
`pnpm ci:local` before declaring the change ready. Use synthetic fixtures and
local or mocked services for verification.

## 8. Observability

- Preserve existing success/error toasts and structured API logging. No new
  application events or metrics are required for this feature.
- Any necessary diagnostics use `@acme/logger` and exclude form values,
  credentials, and personal data.
