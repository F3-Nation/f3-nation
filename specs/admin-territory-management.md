# Territory administration and depth-agnostic AO counts

> Human designer: Crash (Andy Pickler, @BigGillyStyle); tracked in
> [F3-Nation/f3-nation#924](https://github.com/F3-Nation/f3-nation/issues/924)

## 1. Summary

Make Territory a fully manageable tier in the admin app and make the AO count on
each organization correct for any hierarchy depth. Administrators can list,
create, edit, and deactivate Territories, and can move an Area between a Sector
and a Territory, through the shared organization table and editor. The rollout is
gradual, so an Area may sit directly under a Sector or under a Territory
indefinitely, and every screen and count must treat both shapes as normal.

The AO count stored on Regions, Areas, Territories, and Sectors is maintained by
one depth-agnostic recount that the database trigger, the migration backfill, and
the seed all share, so a sixth (or later) tier no longer leaves counts stale.

## 2. Context & links

- Issue #924; epic #855. Design rationale:
  [ADR 0003](../docs/adr/0003-depth-agnostic-org-hierarchy.md).
- Issue #1041 restores Area sorting by resolved Sector and Territory.
- Builds on [`territory-org-type.md`](territory-org-type.md), which added the
  Territory type, basic page, and a temporary API gate rejecting an Area beneath a
  Territory, and on [`admin-generic-org-management.md`](admin-generic-org-management.md),
  which introduced the shared table, editor, and ancestry filters. Where this spec
  gives the Territory table or the Area columns different behavior, this spec
  governs.
- Traversal conventions (depth cap, cycle guard) follow
  [`org-tree-depth-agnostic-traversal.md`](org-tree-depth-agnostic-traversal.md).
- Apps affected: admin, api, db (migration and seed), shared.
- Key code:
  - `apps/admin/src/app/_components/org/{org-admin-config,org-ancestry,use-org-filters,org-table}`
  - `apps/admin/src/app/_components/modal/{org-editor-config,admin-org-edit-modal}`
  - `apps/admin/src/app/_components/modal/{admin-manage-access-modal,admin-users-modal}.tsx`
  - `apps/admin/src/app/{users,event-types}/org-filter.tsx`
  - `packages/shared/src/app/org-hierarchy.ts`
  - `packages/api/src/assert-valid-parent-type.ts`
  - `packages/db/drizzle/` (depth-agnostic AO-count migration), `packages/db/src/seed.ts`
  - `packages/db/scripts/{territory-migration.md,rollback-territory-org-type.sql}`

### Definitions

- **Count-carrying types**: Region, Area, Territory, and Sector. Nation and AO carry
  no maintained count.
- **AO count** of a count-carrying organization: the number of active AOs anywhere
  in its subtree, counting an AO only when every organization strictly between the
  AO and that organization is active. The organization's own active status is not
  checked, so a deactivated Region keeps the count of its active AOs.
- **Mixed shape**: a Sector that has some Areas directly beneath it and other Areas
  beneath its Territories.

### Design

- The Area editor's parent selector offers Sectors and Territories, grouped by
  type. Other editors keep a single parent type and an ungrouped list. The
  selectable parent types per tier are an explicit, deliberately narrower list than
  the server's ordinal rule, and every selectable type must be accepted by that
  rule.
- Ancestor types used by filters and columns are derived from hierarchy rank rather
  than from hand-written tier lists.
- Ancestor columns are resolved by walking the loaded hierarchy independently for
  each ancestor type, so a missing optional tier (no Territory) does not blank the
  tiers above it. The Area table sorts these columns on the server using the
  nearest matching ancestor, before pagination. Traversal includes inactive
  ancestors, excludes the row itself, guards cycles, and stops after
  `ORG_TREE_MAX_DEPTH` parent edges. A missing match sorts last in either direction.
  Ancestor sorts append ascending organization ID as a tie-breaker unless the
  caller already supplies an ID sort; all other requested sort keys keep priority.
  Existing sorts and other table configurations retain their behavior.
- AO counts are recomputed from source rows for every affected ancestor, never
  incremented. The recount walks up from the changed organization (and, for a
  move, from its old parent), then counts each affected count-carrying ancestor's
  subtree. It locks the affected rows in id order before counting, so concurrent
  writes cannot lose an update.

## 3. User stories

- As an administrator, I want to manage Territories through the same screens as
  every other tier so that a new tier does not need bespoke pages.
- As an administrator, I want an Area to be editable and re-parentable whether it
  sits under a Sector or a Territory so that a gradual rollout never strands an
  un-migrated Area.
- As an administrator, I want tables and filters to show and match the Territory
  and Sector an Area or Region belongs to, however many tiers sit between, so that
  I can find records during the rollout.
- As an administrator, I want to grant and filter access on Territories so that
  Territory leaders can be managed like other tiers.
- As a maintainer, I want AO counts to stay correct when an Area moves between a
  Sector and a Territory, an intermediate organization is deactivated, or another
  tier is added so that the depth of the tree never changes the numbers.
- As an operator, I want a single repair function and a before/after view so that
  I can verify and correct counts during the rollout.

## 4. Acceptance criteria (testable, non-contradictory)

### Territory page and table

- **AC-1** — GIVEN an authorized admin-app user WHEN they open `/territories` THEN
  the shared organization page lists Territories with server pagination, search,
  and sorting, the status and Only Mine filters, an AO Count column, and an Add
  button shown according to `orgAdminConfig.territory.add`. No Territory-specific
  route, table, or modal file exists.
- **AC-2** — GIVEN the Territory table WHEN it loads THEN it shows a Sector column
  and a Sector filter; selecting a Sector requests only Territories whose parent is
  that Sector, and sorting the Sector column sorts by the parent's name.
- **AC-3** — GIVEN the Territory editor WHEN a user creates, edits, or deactivates
  a Territory THEN it uses the shared organization editor and confirmation, the
  parent selector offers Sectors only, and the saved parent is the chosen Sector.

### Area parent selection

- **AC-4** — GIVEN the Area editor WHEN parent choices load THEN the selector is
  labeled "Sector or Territory", queries Sectors and Territories, and lists them
  in two groups titled "Sectors" and "Territories", each sorted by name. Sector,
  Territory, Region, and AO editors keep a single-type, ungrouped list.
- **AC-5** — GIVEN an existing Area whose parent is a Sector WHEN it is opened THEN
  that Sector is selected, and saving without changing the parent succeeds and
  submits the same parent.
- **AC-6** — GIVEN an existing Area whose parent is a Territory WHEN it is opened
  THEN that Territory is selected, and moving it to a Sector, or an Area under a
  Sector to a Territory, persists the new parent and the Area remains editable
  afterward.
- **AC-7** — GIVEN the server WHEN an Area is created beneath, or reparented to, a
  Territory THEN the request succeeds. The server continues to reject a Territory
  under an Area, an AO under any non-Region parent, any parent that does not
  outrank the child, and any parent for a Nation.
- **AC-8** — GIVEN each organization type in the editor configuration WHEN its
  selectable parent types are enumerated THEN every one is accepted by the server's
  parent-type rule, so the editor never offers a parent the server rejects.

### Ancestor columns and filters

- **AC-9** — GIVEN the Area table WHEN an Area sits under a Territory THEN its row
  shows both the Territory name and the Sector name (resolved through the
  Territory); WHEN an Area sits directly under a Sector THEN its row shows the
  Sector name and a blank Territory. Both headers request server sorting using
  `sectorName` and `territoryName` respectively. Ascending and descending sorting
  use the nearest matching ancestor's name before pagination; missing ancestors
  are grouped last and ties have stable ordering across pages.
- **AC-9a** — GIVEN mixed, deep, inactive, or cyclic ancestor chains WHEN either
  ancestor sort is requested THEN traversal terminates, selects the nearest
  matching ancestor within 20 parent edges (excluding the row itself), and treats
  an absent or out-of-budget match as missing. Area display uses the same shared
  depth limit, leaving out-of-budget names blank. Other tables retain their
  existing ancestor-display behavior. Existing filters and authorization
  scoping still apply; other tables retain their sort behavior.
- **AC-10** — GIVEN the Area table WHEN a Sector is selected in the filter THEN it
  requests Areas directly beneath that Sector and Areas beneath any of its
  Territories; WHEN a Territory is also selected THEN only that Territory's direct
  children are requested; WHEN the Sector selection changes THEN selected
  Territories that are no longer beneath a selected Sector are removed.
- **AC-11** — GIVEN the Region table WHEN a Sector or Area filter is applied THEN
  Regions whose Area sits directly under the Sector and Regions whose Area sits
  under one of the Sector's Territories are both returned, including when
  intermediate organizations are inactive; a selection that matches nothing
  requests no rows rather than all rows.
- **AC-12** — GIVEN the ancestor-type lists used by the admin filters WHEN they are
  computed THEN they are derived from hierarchy rank (types above Region, and types
  above Area) and equal Area, Territory, Sector, Nation and Territory, Sector,
  Nation respectively.

### Role and organization pickers

- **AC-13** — GIVEN the manage-access modal, the users modal, and the event-types
  organization filter WHEN their organization lists load THEN they request every
  organization type above AO, including Territory.
- **AC-14** — GIVEN the users organization filter WHEN no explicit types are passed
  THEN it offers every type above AO except Nation, including Territory.

### AO counts

- **AC-15** — GIVEN a Nation, Sector, Territory, Area, Region chain WHEN an active
  AO is created beneath the Region THEN the Region, Area, Territory, and Sector
  each have an AO count of 1 and the Nation's count is unchanged.
- **AC-16** — GIVEN a mixed-shape Sector with one Area directly beneath it and one
  Area beneath a Territory, each with AOs WHEN counts are read THEN the Sector's
  count is the total of both Areas, the Territory's count is its Area's count, and
  each Area's count is its own.
- **AC-17** — GIVEN an active AO WHEN it is deactivated, reactivated, or hard
  deleted THEN every count-carrying ancestor updates accordingly.
- **AC-18** — GIVEN a Region, Area, or Territory WHEN it is deactivated THEN AOs
  beneath it stop counting toward ancestors above it, its own count is unchanged,
  and reactivating it restores the ancestors' counts.
- **AC-19** — GIVEN an organization of any type WHEN it is moved to a different
  parent THEN both the old and the new ancestor chains are recounted, including an
  Area moving between a Sector and a Territory, between Sectors, and a Region moving
  between Areas.
- **AC-20** — GIVEN a write that changes neither parent, active status, nor type
  (a rename, or a save that resubmits unchanged values) WHEN it commits THEN no
  count changes and no ancestor's `updated` timestamp changes.
- **AC-21** — GIVEN a chain of up to 20 levels beneath a count-carrying
  organization, of any mix of types, WHEN an AO beneath it changes THEN that
  organization's count is correct; GIVEN a parent cycle WHEN a recount runs THEN it
  terminates.
- **AC-22** — GIVEN concurrent transactions each inserting an AO under the same
  Region WHEN both commit THEN the Region's and its ancestors' counts include both.
- **AC-23** — GIVEN counts corrupted by direct edits WHEN
  `recount_org_ao_counts()` runs with no argument THEN every count-carrying
  organization is corrected and an immediate second run reports zero changes; the
  migration runs this once as a backfill.
- **AC-24** — GIVEN the migration WHEN `org_ao_count_expected()` is queried THEN it
  returns the expected count for each count-carrying organization without writing,
  so an operator can compare it with stored counts before and after.
- **AC-25** — GIVEN `app.disable_ao_count_trigger` is set to true, empty, or unset
  WHEN organizations change THEN the trigger skips counting only when it is true, and
  never raises for an empty value.
- **AC-26** — GIVEN the seed WHEN it finishes THEN it recounts through
  `recount_org_ao_counts()`, and the resulting counts equal those the trigger
  produces for the same data.

### Rollout safety

- **AC-27** — GIVEN the rollback script for the Territory enum migration WHEN it is
  run after the depth-agnostic count migration THEN it restores the previous
  fixed-depth trigger function and removes the new recount functions, and the
  migration documentation describes both steps. This is exercised on an isolated
  local database.

## 5. Roles & authorization (RBAC)

This adds no permission rule and changes no procedure tier. Showing an option in a
picker is not a grant of permission; the existing procedures and per-organization
checks stay authoritative.

| Action                                              | Allowed                                                                                                                   | Explicitly denied                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| List and read organizations (`org.all`, `org.byId`) | Existing `protectedProcedure` callers under current list scoping                                                          | Unauthenticated callers                                                      |
| List accessible organizations (`org.accessible`)    | Existing `protectedProcedure` callers; the endpoint's own scoping decides which organizations are returned                | Unauthenticated callers                                                      |
| Create or edit a Territory or Area                  | `editorProcedure` caller passing `checkHasRoleOnOrg` for editor on the target, or on the parent when creating             | Callers without the procedure tier or without a role on the target or parent |
| Move an organization to a new parent                | Editor on the source and editor on the destination parent, and the server's parent-type rule accepts the destination type | Callers missing either role, or a destination the parent-type rule rejects   |
| Deactivate an organization                          | `adminProcedure` caller passing the admin check on the target                                                             | Editor-only callers, and admins without access to the target                 |
| Grant roles on a Territory                          | Existing role-management flows and checks; Territory now appears in their organization lists                              | Callers failing the existing role-management checks                          |
| Run the count migration or backfill in production   | Human-approved release operation                                                                                          | Automatic execution from this development task                               |

Territory admins and editors inherit access to everything beneath them through the
existing depth-agnostic role check; this change does not alter inheritance.

## 6. Out of scope / non-goals

- A child-listing view on Sectors or Territories. Relationships appear as columns
  and filters only.
- A Territory column on the Region table.
- Nation carrying a maintained AO count.
- Bulk creation of Territories or bulk re-parenting of Areas, and any production
  data change (tracked separately).
- Territory positions, the map update-request escalation ladder, warehouse and
  slackbot mappings, OpenAPI golden regeneration, and the broader seed and fixture
  update for six-level trees (each tracked separately).
- The stale organization-type description text in the API schema, which belongs with
  the OpenAPI golden update.
- Regions parented directly to a Sector, Territory, or Nation, which the admin
  editor cannot create.
- Any change to authorization inheritance, procedure tiers, or role rules.

## 7. Critical-path test cases

- Six-level chain: Region, Area, Territory, and Sector counts after creating an AO.
- Mixed-shape Sector counts, and the Area move between a Sector and a Territory in
  both directions and across Sectors.
- Inactive intermediate (Region, Area, Territory) drop and restore.
- Delete, deactivate, and reactivate an AO.
- Concurrent AO inserts under one Region.
- Full-table recount repair with a second run reporting zero changes.
- Area editor: grouped selector, un-migrated Area stays editable, Sector-to-Territory
  reparent.
- Area and Territory table columns and filters, including an Area directly under a
  Sector and an Area under a Territory.
- Server accepts Area beneath Territory and still rejects invalid parents; every
  selectable parent type is accepted.
- Territory in the role and organization pickers.

## 8. Observability

- No new application events. The migration's backfill emits a database notice with
  the number of corrected organizations.
- Before enabling Area re-parenting in production, the operator exports each
  count-carrying organization's stored count, runs the migration, and compares the
  before and after values, using `org_ao_count_expected()` for any later check.
  Report aggregate differences only, without organization contents beyond ids.
