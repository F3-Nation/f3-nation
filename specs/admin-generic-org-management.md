# Shared organization administration

> Human designer: Michael (@michaeldpotter)
>
> Accepted implementation scope. The five-type conversion, local CI, browser
> comparisons, and local database-backed verification are complete as of
> September 9, 2026.

## 1. Summary

Replace the five organization administration tables, edit dialogs, and page
shells with shared components driven by configuration. Administrators retain
the existing Nation, Sector, Area, Region, and AO screens and behavior.
Maintainers can introduce another supported organization type without copying
page, table, or dialog files. Introduce the shared editor with Sector and Area
first, then extend the extraction in small reviewable steps.

## 2. Context & links

- Issue: https://github.com/F3-Nation/f3-nation/issues/919; parent epic #855.
- App(s) affected: admin; shared display/hierarchy configuration and validators
  where necessary to remove per-type wiring.
- Key code:
  - `packages/shared/src/app/org-hierarchy.ts`
  - `packages/shared/src/app/constants.ts` (existing route definitions)
  - `packages/validators/src/index.ts` (organization form schemas)
  - `apps/admin/src/app/{the-nation,sectors,areas,regions,aos}/`
  - `apps/admin/src/app/{sectors,areas,regions,aos}/[id]/add-*-button.tsx`
  - `apps/admin/src/app/_components/admin-nav-links.tsx`
  - `apps/admin/src/app/_components/modal/admin-*-modal.tsx`
  - `apps/admin/src/app/_components/modal/admin-delete-modal.tsx`
  - `apps/admin/src/app/_components/modal/modal-switcher.tsx`
  - `apps/admin/src/utils/store/modal.ts`
  - `apps/admin/src/app/regions/org-ancestry.ts` and its existing tests
  - `packages/api/src/router/org.ts` (existing API contract)
- Preserve the ancestry behavior delivered by #920. This work extracts its
  integration without redesigning the filtering algorithm.

### Design

Shared hierarchy configuration owns names, route segments, icons, and
hierarchy relationships. Admin configuration owns columns, filters, form
options, creation defaults, and existing presentation exceptions. A selector's
usual parent type is not a new server-side restriction on valid parent edges.

One editor receives an organization type and optional ID. It uses configuration
to choose the existing validation behavior, parent query, labels, and optional
fields; shared code loads the record, handles the form, saves, and refreshes.
One table owns the common rendering and query lifecycle, with configured
columns and explicit filter integrations. One page shell resolves organization
routes from configuration. Existing URLs continue to work. Routing must also
preserve unrelated admin pages and reject unknown organization route segments.

The concrete consolidation plan is:

- **Editor and confirmation dispatch:** replace the five organization editor
  variants in `ModalType`, `DataType`, and the modal switcher with one generic
  organization entry carrying `{ orgType, id? }`. Replace the five organization
  variants in `DeleteType` with one organization variant whose confirmation
  data carries `{ orgType, id }`. Use the type for labels and dispatch while
  preserving the existing ID-only `org.delete` request. Keep non-organization
  modal and deletion variants working as before.
  Preserve organization editor stack identity using `(modalType, orgType)`:
  opening another editor of the same organization type replaces that entry;
  opening a different organization type retains the previous entry so closing
  the top editor restores it. Cover both cases with store regression tests.
  Targeted organization-editor closing must also identify the organization
  type, so closing one type does not remove other stacked organization editors.
  Preserve no-argument close (top entry), close-all, and non-organization
  targeted-close behavior.
- **Navigation and add action:** generate organization navigation entries from
  shared display metadata, preserving their current order, labels, icons, and
  URLs. Replace the four per-type add buttons with one shared action that opens
  the generic editor for the configured type. The page's admin configuration
  controls whether that action is shown; Nation continues to omit it.
- **Route resolution:** consolidate organization pages into a shared dynamic
  route, proposed as `app/[orgSegment]/page.tsx`, with a segment-to-type lookup
  derived from the configured route segments. Unknown segments return the
  application's not-found response before any organization query. Preserve
  existing static routes for unrelated admin pages. Verify this arrangement
  against installed Next.js routing documentation and route regression tests
  before replacing the current organization route files.
  Four current organization pages export `dynamic = "force-dynamic"`; AO
  does not. The root layout already reads request headers and session data,
  so the export difference alone does not establish a rendering difference.
  Verify the installed framework behavior and build output, then document the
  consolidated rendering policy before removing the existing pages. Preserve
  existing authentication behavior and verify arbitrary unknown paths as well
  as unrelated static routes.
- **Ancestry/filter helpers:** move shared ancestry and filter modules from
  `app/regions/` into `app/_components/org/`, together with their colocated
  tests. Update consumer and test imports without changing the filtering
  algorithm or weakening the existing regression assertions.
  Migrate `org-filters.test.tsx` from the removed Region/Area table components
  to the generic table configured with `orgType="region"` or `"area"`, and
  update its modal-store mocks to the consolidated entries. Preserve every
  existing behavioral assertion; assertion syntax may change with the harness.
- **Validation:** place schema selection at the admin configuration boundary,
  backed by the organization schemas in `packages/validators/src/index.ts`.
  Sector, Area, Region, and AO currently share the same explicit validation
  rules; Nation has a different parent rule. Reuse shared validation rules and
  configure the parent constraint so another supported type does not require
  a new schema switch case. Preserve current validation messages and accepted
  values; optional visible fields are a separate form-presentation concern.

The initial editor conversion covers Sector and Area. Table extraction,
remaining editor variants, navigation/modal wiring, and route consolidation
follow after reviewing that first conversion. Temporary adapters are allowed
during the conversion; the completed change removes the five duplicate tables
and dialogs and requires no new per-type page files.

### Existing differences to preserve

All five tables display name, status, annual review, and creation date. Each
retains its existing column order, formatting, row actions, and responsive UI.

| Type   | Parent selector | Additional table columns | Filters                         | Editor extras                                     |
| ------ | --------------- | ------------------------ | ------------------------------- | ------------------------------------------------- |
| Nation | None            | None                     | No custom filters               | No dialog deactivate button                       |
| Sector | Nation          | AO count                 | Status, Only Mine               | New name defaults to `Unknown`                    |
| Area   | Sector          | Sector, AO count         | Status, Only Mine, Sector       | New name defaults to blank                        |
| Region | Area            | Area, Sector, AO count   | Status, Only Mine, Sector, Area | Logo and location short description               |
| AO     | Region          | Region                   | Status, Only Mine, Region       | Logo; existing development-only fake-data control |

The four non-Nation pages retain their add buttons and default Active + Only
Mine filters. Nation retains no add button, its `Nations` page heading, and its
`The Nation` navigation label. Preserve current sorting behavior, including
Region's lack of explicit API sorting wiring. Preserve Nation's existing table
deactivation action visibility, including on inactive rows. Record newly found
inconsistencies for separate decisions rather than changing them in extraction.

The baseline also includes these query and presentation details:

| Type   | Search/pagination              | Sorting                          | Additional details                                                                                                              |
| ------ | ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Nation | Client-side over returned rows | Client-side                      | Query sends only `orgTypes: ["nation"]`; the table does not pass `totalCount` to `MDTable`. The API defaults to active records. |
| Sector | Server-driven                  | Server-driven                    | Empty search is sent as `undefined`.                                                                                            |
| Area   | Server-driven                  | Server-driven                    | Empty search is sent as `undefined`.                                                                                            |
| Region | Server-driven                  | Client-side over the loaded page | Empty search is sent as `undefined`; page-size choices are 10, 20, 50, 100.                                                     |
| AO     | Server-driven                  | Server-driven                    | Empty search remains `""`; no selected Regions sends `parentOrgIds: []`; table container uses `max-w-full`.                     |

Nation starts with page size 20. The four controlled tables start with the
`usePagination()` default of 10, which takes precedence over their internal
`paginationOptions.pageSize` value of 20. Tables other than Region retain the
shared table's 10, 20, 50 page-size choices. Nation retains its client-side search,
pagination, sorting, and displayed row count; absence of server wiring does
not mean these controls are absent. Its inactive-row action remains part of
the component baseline even though the normal query returns active records.

AO's Region filter independently queries `org.all` with
`{ orgTypes: ["region"] }`; retain that option source rather than replacing it
with the Area/Region tables' hierarchy-derived filter options. Preserve the
per-type distinction between an empty parent-ID array and `undefined`.

Preserve column identifiers as well as labels and accessors. Sector/Area use
`status` for the status column; Nation/Region/AO use `isActive`. Area's Sector
column has ID `parentOrgName` and accessor `sector`; AO's Region column uses
`parentOrgName` for both. AO's Region cell is blank unless the row's
`parentOrgType` is `region`. Its name-column heading is `Name`, not `AO`;
column headings belong in admin presentation configuration.
Region uses `area` and `sector` for its ancestry columns. The API recognizes
only `id`, `name`, `parentOrgName`, `aoCount`, `lastAnnualReview`, `status`, and
`created` as sorting IDs and drops unknown IDs. Do not normalize identifiers
or add server sorting wiring during extraction; preserve local sorting where
the shared table currently provides it.

Sector/Area/Region use parent Select controls with options sorted by name.
AO uses a VirtualizedCombobox with Region options in supplied order, moving
selected options first within the control rather than sorting alphabetically.
AO preserves its `error.message` feedback with `Failed to update ao` fallback
and its fixed `Successfully updated ao` success text, including on creation.

Nation retains its `w-1/2` field wrappers and dialog classes
`max-w-[90%] rounded-lg lg:max-w-[600px]`. Unlike the other editors, it does
not add a dialog-content height limit or internal scrolling; the shared
overlay still supports scrolling. Preserve both Nation mutation-error
feedback and the submit catch's `Failed to update nation` feedback, including
the distinct authorization message from the mutation handler. Assert the
feedback behavior rather than silently deduplicating it during extraction.

Sector/Area show field validation errors without a validation-failure toast;
Nation/Region/AO additionally toast `Failed to update <type>` for invalid
submissions. Sector/Area save failures use the mutation error handler's
single toast; a shared submit wrapper must not add another. Preserving this
feedback does not require preserving an unhandled promise rejection.

Preserve each type's outgoing field set. Area includes `logoUrl` in form
defaults/reset values despite having no logo control; Sector and Nation omit
it. A common defaults object must not begin sending absent fields or clearing
stored values. Verify payloads as well as persisted values.
Include metadata in defaults/reset verification: Nation/Sector/Area/Region
use `{}` as the missing-metadata default and `null` on reset; AO uses `null`
in both. Verify the resulting create/edit payloads after form initialization
and record loading, rather than assuming default values are submitted as-is.
AO currently resets from a spread of its loaded record; preserve observable
form and payload behavior without requiring that literal implementation.
Region/AO extend their editor schemas with `badImage` preview state. Preserve
image-load/error feedback and its interaction with reset and validation in the
shared editor without treating it as a new persisted organization field.

## 3. User stories

- As an authorized editor, I can edit an organization through its existing
  screen and retain the same fields, validation, and save behavior.
- As an administrator, I can use the existing tables, filters, and deactivation
  flow after their implementation is shared.
- As a maintainer, I can configure another supported organization type without
  duplicating an admin page, table, or editor.

## 4. Acceptance criteria (testable, non-contradictory)

### First conversion: Sector and Area editors

- **AC-1** — GIVEN an existing Sector or Area WHEN its table row is clicked
  THEN the editor loads that record with the correct type-specific title,
  existing field values, and read-only ID.
- **AC-2** — GIVEN the Sector editor WHEN parent choices load THEN its Nation
  selector displays the Nation query results sorted by name, with the current
  selection retained as in the existing editor.
- **AC-3** — GIVEN the Area editor WHEN parent choices load THEN its Sector
  selector displays the Sector query results sorted by name, with the current
  selection retained as in the existing editor.
- **AC-4** — GIVEN the add action WHEN its editor opens THEN Sector starts
  with `Unknown` and Area with a blank name; other defaults match their
  existing editors.
- **AC-5** — GIVEN input rejected by the existing type's form schema WHEN Save
  is clicked THEN the same field validation prevents a mutation.
  Sector/Area display field errors without a validation-failure toast.
- **AC-6** — GIVEN valid edits and permission WHEN Save succeeds THEN the
  organization ID and type remain correct, the dialog closes, the existing
  success toast appears, and the refreshed table reflects the saved values.
- **AC-7** — GIVEN an existing record WHEN only its name is changed and saved
  THEN untouched values survive, including parent, contact fields, annual
  review, default location, metadata, and any stored logo.
  Assert the outgoing field set against the existing editor, including Area's
  retained `logoUrl` and Sector's omission of that field; omitted fields must
  not become explicit nulls or defaults through shared form construction.
  Include metadata defaults/reset behavior and the resulting create/edit
  payloads in form regression coverage.
- **AC-8** — GIVEN a save rejected as unauthorized WHEN the response arrives
  THEN the dialog retains the entered values, displays the existing
  type-specific authorization error, and leaves the saving state.
- **AC-9** — GIVEN another save failure WHEN the response arrives THEN the
  dialog retains the entered values, displays the existing type-specific
  failure message, and leaves the saving state.
  Sector/Area retain one failure toast, including for unauthorized saves in
  AC-8; a shared submit wrapper does not duplicate it.
- **AC-10** — GIVEN unsaved changes WHEN Cancel is clicked THEN the dialog
  closes without a mutation.
- **AC-11** — GIVEN an active existing Sector or Area WHEN its editor opens
  THEN its deactivate button opens the existing confirmation for that ID and
  type; new and inactive records have no editor deactivate button.

### Complete five-type conversion

- **AC-12** — GIVEN each existing organization URL WHEN visited directly or
  through navigation THEN its page loads with the same heading and add-action
  availability, including the Nation exceptions above.
- **AC-13** — GIVEN each organization's table WHEN loaded on desktop or mobile
  THEN its columns, filters, row actions, and their presentation match the
  baseline matrix and existing screen.
- **AC-14** — GIVEN a non-Nation table WHEN first opened THEN Active and Only
  Mine are selected and constrain the query as before.
- **AC-15** — GIVEN search text, a page selection, or a supported sort WHEN
  changed THEN results and request parameters follow the existing behavior
  for that type, including Region's existing sorting exception.
  Include AO's Region-option query and empty `parentOrgIds` array in coverage.
- **AC-16** — GIVEN selected Sector/Area ancestry filters WHEN selections
  change THEN descendants through intervening levels and inactive ancestors
  remain correctly represented; missing ancestry data or an empty selected
  subtree does not broaden results. Preserve the #920 regression assertions.
  Exercise those assertions through the generic Region/Area table instances
  after migrating the existing component tests and modal mocks.
- **AC-17** — GIVEN modified filters plus search/sorting WHEN Reset Filters
  is clicked THEN filter defaults return without clearing search or sorting,
  matching the existing per-type behavior.
- **AC-18** — GIVEN a Nation, Region, or AO record WHEN edited THEN common
  fields, validation, submission, and errors behave as before, with the parent
  and optional fields in the matrix. Nation has no parent selector or dialog
  deactivate button.
- **AC-19** — GIVEN a Region or AO WHEN a stored logo URL exists or a file is
  selected THEN the existing preview, upload, and save behavior are preserved.
  There is no editable logo-URL text field. For a successful new-record save,
  preserve create-then-update even when no file is selected. When a file is
  selected, create first to obtain the ID, upload, then update. Preserve
  existing upload-error feedback and failure-path behavior; test creation
  with and without a file and an upload failure.
- **AC-20** — GIVEN a Region WHEN its location short description is edited
  THEN it is saved under the existing metadata key without losing other
  metadata.
- **AC-21** — GIVEN an authorized administrator WHEN confirming deactivation
  THEN `org.delete` receives `{ id }` for the selected organization, without an
  `orgType` field, matching the current client contract. Type metadata selects
  the confirmation label and organization dispatch; the existing refresh
  behavior occurs, and cancelling does not mutate the record.
- **AC-22** — GIVEN a test-only sixth type added to an isolated
  type/hierarchy/admin configuration and an org API client test double that
  supports it WHEN its URL is visited
  THEN navigation, table, add/edit dialog, parent choices, and a successful
  save work without a new per-type source file or component switch case.
  Assert the outgoing read/save payloads and success handling through the
  shared UI. The fixture replaces the org API client; it does not invoke the
  real `packages/api/src/router/org.ts` procedures for the sixth type. Do not
  add a production enum value or database migration. This demonstrates admin
  extensibility, not real backend persistence or support for arbitrary strings.
- **AC-23** — GIVEN an authenticated user with admin portal access WHEN an
  unknown organization route segment or an arbitrary unknown one-segment path
  is visited THEN the not-found response is shown and no organization query
  is issued. Unauthenticated visitors retain the existing login redirect;
  unrelated existing admin routes continue to resolve normally.
  Preserve existing root-layout/session/authentication behavior; this criterion
  does not require suppressing authentication work already performed there.

AC-1 through AC-11 form the first review boundary. Completion of #919 requires
all criteria plus source inspection confirming that one shared table and one
shared editor replace the five duplicate implementations.

## 5. Roles & authorization (RBAC)

Keep the existing API procedures and permission checks authoritative. Showing
an action or parent option is not a grant of permission. This refactor does not
change the authorization model or introduce new endpoints.

| Action                                                      | Allowed                                                                                       | Explicitly denied                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Query org lists/details                                     | Existing `protectedProcedure` callers, subject to current query scoping                       | Callers rejected by the protected procedure                                                          |
| Create from an existing non-Nation add screen               | `editorProcedure` caller passing `checkHasRoleOnOrg` for editor access on the supplied parent | Unauthenticated callers, callers without the procedure role, or callers without scoped parent access |
| Update an existing organization, including its status field | `editorProcedure` caller passing the editor check on the target org                           | Callers without target-org editor access, even if they have a role elsewhere                         |
| Change an organization's parent                             | Update permission on the source plus editor permission on the destination parent              | Callers missing either source or destination permission                                              |
| Confirm deactivation through `org.delete`                   | `adminProcedure` caller passing the admin check on the target org                             | Editor-only callers and administrators without scoped target access                                  |

Existing role inheritance and API-key behavior remain governed by the current
procedure wrappers and `checkHasRoleOnOrg`; configuration does not reinterpret
them. Preserve the distinction between editing the status field through
`crupdate` and the dedicated admin-only deactivation operation. Unauthorized
mutation regressions must verify that persisted data is unchanged.

## 6. Out of scope / non-goals

- Adding Territory or another production organization type.
- Database/schema migrations, API authorization changes, or hierarchy-integrity
  enforcement owned by other issues.
- Redesigning cascading filters, normalizing visible quirks, adding fields to
  existing editors, or enabling missing sorting behavior.
- Pushing, creating a PR, merging, or deploying without the user's requested
  write authorization.

## 7. Critical-path test cases

- Sector and Area: open existing record, validate, rename/save/reopen, preserve
  untouched data, cancel, and retry after unauthorized/general save failure.
- Sector and Area: create with the correct parent type and defaults; open and
  cancel deactivation, then verify authorized confirmation.
- Permission regressions: unrelated organization role, editor-only dedicated
  deactivation, and unauthorized destination parent.
- All five pages: direct routes, navigation, table/action parity, and edit
  smoke coverage, including Nation exceptions.
- Existing ancestry tests plus table-level filter/reset regressions.
- Region/AO stored-logo preview, file upload, and create-then-update flows
  with and without a file, including upload failure, using synthetic fixtures
  and local or mocked services.
- Organization editor stack replacement/restoration across same and different
  organization types, targeted closing by organization type, and existing
  non-organization modal regressions.
- Sixth-type configuration fixture through route, table, dialog, and save;
  unknown-route and unrelated-route regressions.

The sixth-type fixture extends only test configuration and substitutes the
org API client at its boundary with the shared UI. Assertions must verify that
the configured type reaches list/detail queries and create/update payloads,
that configured parent choices render, and that a successful test response
drives the normal close/refresh behavior. Do not substitute the route resolver,
table, or editor with fixture-specific implementations. The real five-type
flows must separately verify the supported API contract and persistence using
synthetic fixtures in an authorized test environment; a sixth-type mock is not
evidence of backend support.

The fixture may replace shared display/hierarchy and admin configuration
modules through module-level `vi.mock` boundaries. Supply a complete sixth-type
configuration entry, not merely an appended enum value or a type assertion.
Keep the route resolver, table, and editor implementations real so the test
demonstrates that configuration reaches their normal execution paths.

Run focused tests for each conversion, browser verification for the changed
flows, and `pnpm ci:local` before declaring the full change ready. Run all
toolchain commands via `direnv exec .`. A draft-spec-only change does not
require application tests.

## 8. Observability

Retain existing user-facing success/error toasts and API logging. No new events
or metrics are required for extraction. Any necessary diagnostic logging uses
`@acme/logger` and excludes form values, credentials, and personal data.
