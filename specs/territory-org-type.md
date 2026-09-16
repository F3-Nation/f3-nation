# Territory organization type

> Human designer: Michael (@michaeldpotter); implementation scope approved
> in conversation on September 15, 2026.

## 1. Summary

Add Territory between Area and Sector in the organization hierarchy. Keep
PostgreSQL, TypeScript, and Python enum ordering aligned, preserve existing
organization and position data, and expose the basic Territories admin page
through the existing shared components.

## 2. Context & links

- Issue: [#923](https://github.com/F3-Nation/f3-nation/issues/923); epic #855.
- Prerequisite: #999, merged in #1019. Deployment readiness of the separately
  released homepage must be checked before production rollout.
- Follow-up: #924 owns full Territory management verification, mixed
  Sector/Territory Area parents, hierarchy filters, and ancestor displays.
- External mirror: F3-Nation/f3-region-pages#96; coordinate after merge.
- Affected workspaces: db, db-python, shared, admin; other enum consumers
  require regression verification, including homepage.
- Key files:
  - `packages/shared/src/app/{enums,constants,org-hierarchy}.ts`
  - `packages/db/drizzle/schema.ts`, generated migration and metadata
  - `packages/db-python/f3_data_models/models.py`
  - `apps/admin/src/app/_components/org/org-admin-config.ts`
  - `apps/admin/src/app/_components/modal/org-editor-config.ts`
  - `apps/admin/src/app/_components/admin-nav-links.tsx`
  - `apps/admin/src/app/[orgSegment]/page.tsx`

### Proposed configuration and migration

The ordered values are `ao`, `region`, `area`, `territory`, `sector`, `nation`.
Update the TypeScript order assertion deliberately. Python ordinals become
1 through 6 in that order; SQLAlchemy must continue persisting member names.

Recreate the PostgreSQL enum following migration `0017_even_thing.sql`:
cast both dependent columns to text, drop/recreate the enum, and cast both
columns back. Preserve the nullable `positions.org_type` column and the
non-nullable `orgs.org_type` column. The existing org-type index explicitly uses
`enum_ops`; handle its drop/recreation around the text conversion and verify
the final index definition. Keep the Drizzle journal and snapshot consistent.
The deployment migration must execute transactionally so an error cannot leave
the columns as text or the index absent.

Territory display metadata uses `Territory`, `Territories`, the public URL
segment `territories`, admin route `/territories`, and the chosen `LandPlot`
icon. Extend both the icon-name union and the admin icon map.

Use a minimal Sector-like table configuration: Add enabled, server pagination
and sorting, status/Only Mine filters, AO count, and no ancestry columns.
The exhaustive editor configuration also needs a Territory entry: Sector
parent selector, blank initial name, no logo control, and the existing shared
validation/deactivation behavior. Existing Area parent choices remain Sector
until the mixed-parent work in #924. This change inserts no Territory records
and reparents no existing organizations.

## 3. User stories

- As a maintainer, I can introduce the sixth tier without losing existing
  organization or position types.
- As an authorized admin-app user, I can reach the basic Territories page
  from the sidebar through the shared organization route.
- As a release operator, I have verified forward and reverse migration
  procedures before any real Territory records are introduced.

## 4. Acceptance criteria

- **AC-1** — After migration, PostgreSQL enum declaration order, the shared
  TypeScript array, and Python member-name order are exactly `ao`, `region`,
  `area`, `territory`, `sector`, `nation`.
- **AC-2** — Existing rows in both `orgs` and `positions` retain their complete
  data through migration, including null position types; column nullability
  is unchanged and `idx_orgs_org_type` is valid with the expected definition.
- **AC-3** — The migration is exercised on an isolated database restored from
  a production-shaped dump, with preservation evidence captured before and
  after. A fresh seed alone does not satisfy this criterion. Record the
  dump's provenance and limitations without recording sensitive row data.
- **AC-4** — On the migrated isolated database with no Territory values in
  either dependent column, exercise a transactional rollback to the original
  five-member enum and verify data, index, and column properties again. Also
  verify rollback refuses safely if either column contains Territory, without
  deleting or coercing those rows. Document migration-journal reconciliation
  and application-version coordination for an operator-led rollback.
- **AC-5** — All exhaustive shared/admin configuration records include the
  new type; workspace typechecking passes. Python persistence tests establish
  member-name storage despite changed numeric ordinals.
- **AC-6** — The sidebar shows Territories with `LandPlot`; selecting it loads
  `/territories` through `[orgSegment]`, with the correct heading and list
  query. Add visibility follows `orgAdminConfig.territory.add` and opens the
  shared Territory editor. No per-type page, table, or modal is introduced.
- **AC-7** — Existing organization routes and unrelated admin routes retain
  their resolution. Existing five-type regression assertions remain valid;
  new assertions cover Territory ordering, route/icon configuration, and the
  basic page/editor behavior. Homepage enum-driven behavior is checked for
  exhaustive configuration gaps.
- **AC-8** — Verification results distinguish automated tests, browser checks,
  dump/rollback rehearsal, and any unavailable checks. Required local lint,
  formatting, typecheck, and CI gates pass before declaring the change ready.

## 5. Roles & authorization

Preserve current endpoint tiers and resource checks; this adds no permission
rule. Add-button visibility is configuration, not authorization.

| Action                                     | Allowed                                                              | Explicitly denied                                     |
| ------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Read organizations                         | Existing `protectedProcedure` callers under current list scoping     | Unauthenticated callers                               |
| Create/edit via shared editor              | Existing `editorProcedure` and `org.crupdate` resource/parent checks | Callers failing the current role or resource checks   |
| Deactivate                                 | Existing `adminProcedure` and target-org role check                  | Callers failing the current admin or target-org check |
| Execute a production migration or rollback | Human-approved release operation                                     | Automatic execution from this development task        |

## 6. Out of scope / non-goals

- Creating production Territory records or changing existing parent edges.
- #924's full management UX, mixed-parent selector, and ancestry/filter work.
- Changing authorization inheritance, hierarchy validation, or notification
  escalation rules.
- Editing the external warehouse mirror in this repository.
- Production access, data export, deployment, commits, pushes, or external
  messages without their applicable authorization.

## 7. Critical-path test cases

- Forward/reverse migration on a restored, populated isolated database;
  compare row data internally and report only aggregate preservation results.
- Rollback refusal for Territory in `orgs` and separately in `positions`.
- TypeScript/Python/PostgreSQL enum order and Python storage-name assertions.
- Territory sidebar navigation, page loading, Add gating, and editor parent
  configuration; existing route and enum-consumer regression suites.

The production-shaped dump source and isolated restore target must be resolved
before AC-3 can be marked complete. Any production export requires the separate
exact-operation review in `.personal/DATABASE_ACCESS.md`; this spec does not
authorize it. Local synthetic testing can proceed independently once the
implementation criteria are approved.

## 8. Observability

No new application events are needed. Retain migration/test evidence with
schema versions, enum order, index validity, and aggregate preservation results.
Do not include secrets or production row contents. Migration lock behavior and
rollback readiness are release-review items; report timings only when measured.
