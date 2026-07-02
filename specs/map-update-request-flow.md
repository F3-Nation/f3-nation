# Map edit mode & update requests

> Status: DRAFT — acceptance criteria pending owner approval
> Owner (human accountable): Declan Nishiyama (@DeclanNnnnn)

## 1. Summary

Signed-in users can propose changes to the F3 map — creating, editing, moving,
and deleting AOs, locations, and workouts (events) — through an in-map edit
mode. Each proposal is an **update request**. If the submitter is an editor or
admin of _every_ region the change touches, the change applies immediately;
otherwise the request is recorded as **pending** and the affected region's
editors/admins are emailed and can approve (optionally editing the values
first) or reject it from the admin app. This lets any PAX keep the map
accurate while regions retain control over their own data.

## 2. Context & links

- App(s) affected: **map** (submission UI), **api** (`packages/api` request
  router + `apps/api` route middleware), **admin** (review UI). Supporting:
  `packages/db` (`update_requests` table), `packages/validators`
  (request schemas), `packages/mail` (notifications).
- Related Issues / PRs: PR [#274](https://github.com/F3-Nation/f3-nation/pull/274)
  (`feat/new-edit-flow-monorepo`) — this spec describes the behavior of that
  branch and is the acceptance baseline for merging it.
- Key code (PR branch): `packages/api/src/router/request.ts`,
  `packages/api/src/lib/check-update-permissions.ts`,
  `packages/api/src/lib/update-request-handlers.ts`,
  `packages/validators/src/request-schemas.ts`,
  `apps/map/src/utils/open-request-modal.ts`,
  `apps/map/src/app/_components/modal/update/`,
  `apps/admin/src/app/requests/requests-table.tsx`,
  `apps/admin/src/app/_components/modal/admin-requests-modal.tsx`.

## 3. User stories

- As a **signed-in PAX**, I want to suggest a fix to an AO, workout, or
  location so that the map reflects reality, without needing any special role.
- As a **region editor/admin**, I want my own map edits to apply immediately
  so that routine upkeep isn't bottlenecked on review.
- As a **region editor/admin**, I want to review, correct, and approve or
  reject pending requests for my region so that I control what changes land.
- As a **nation admin**, I want visibility into requests across all regions so
  that nothing falls through the cracks.

## 4. Acceptance criteria (testable, non-contradictory)

### Entry & authentication

- **AC-1** — GIVEN an anonymous visitor on the map WHEN they click the
  edit-mode toggle THEN the sign-in modal opens ("You must log in to edit the
  map") and the map remains in view mode.
- **AC-2** — GIVEN a signed-in user WHEN they click the edit-mode toggle THEN
  the map enters edit mode; clicking the toggle again returns to view mode.
- **AC-3** — GIVEN edit mode WHEN the user clicks an empty spot on the map
  THEN an update marker is placed offering: "New location, AO, & event", "Move
  existing AO here", "Move existing event here", and a control to clear the
  marker.
- **AC-4** — GIVEN edit mode with a location selected WHEN the user opens the
  AO or event menus THEN the twelve request types are reachable: AO menu →
  edit AO details, move AO to different location, move AO to different region,
  delete AO; event menu → edit workout details, move to different AO, move to
  a new AO, delete workout; plus "Add Workout to AO" (create event). Each
  opens its request modal prefilled with current values.

### Forms & validation

- **AC-5** — GIVEN any request modal WHEN a required field is invalid per its
  schema (event name < 3 chars, start/end time not 24-hour `HHmm`, no event
  type selected, AO name < 2 chars, AO logo/website not a URL, location
  address < 5 chars, missing lat/lng) THEN a field-level error is shown and
  submission is blocked with no API call.
- **AC-6** — GIVEN a signed-in user with a session email WHEN a request modal
  opens THEN the "Your Email" field is prefilled with that email and disabled.
- **AC-7** — GIVEN an AO logo URL that fails to load WHEN the user submits
  THEN the form shows "Invalid image URL" on the logo field and no API call is
  made.

### Submission outcomes

- **AC-8** — GIVEN a signed-in user who is **not** an editor/admin of every
  affected region WHEN they open a request modal THEN it states the change
  will be submitted for review; and WHEN they submit valid values THEN the
  toast "Request submitted. An admin will review your submission soon."
  appears, the modal closes, a `pending` update request is recorded, and **no
  live map data changes**.
- **AC-9** — GIVEN a signed-in user who **is** an editor/admin of every
  affected region WHEN they open a request modal THEN it states the change
  will be reflected immediately; and WHEN they submit valid values THEN the
  toast "Update request automatically applied" appears, the modal closes, the
  change is live (an `approved` request is recorded), and the map reflects it.
- **AC-10** — GIVEN a pending request is created WHEN submission succeeds THEN
  the affected region's editors/admins are emailed a link to the admin
  requests page (escalating up the org hierarchy if the region has none), and
  a notification failure does not fail the submission.

### Admin review

- **AC-11** — GIVEN an editor of region R signed into the admin app WHEN they
  open the Requests page THEN they see pending requests for their editable
  region(s) by default (status filter `pending`, "Only Mine" on), with request
  type, region, AO, workout, location, submitter, and created date; changed
  fields show new value with the previous value struck through.
- **AC-12** — GIVEN an editor viewing a pending request for their region WHEN
  they adjust any field and click Approve THEN the **edited** values are
  applied to the live tables, the toast "Approved update" appears, the modal
  closes, and the row leaves the default pending view.
- **AC-13** — GIVEN an editor viewing a pending request for their region WHEN
  they click Reject THEN the request status becomes `rejected`, **no live data
  changes**, a confirmation toast appears, and the row leaves the default
  pending view.
- **AC-14** — GIVEN a signed-in user whose only role is `user` WHEN they
  navigate to the admin app THEN they are redirected to the no-access page and
  cannot reach the Requests page.
- **AC-15** — GIVEN an editor of region R WHEN they attempt to reject a
  request belonging to region S (outside their editable orgs) THEN the API
  responds UNAUTHORIZED and the request remains `pending`.
- **AC-16** — GIVEN an approved `delete_ao` or `delete_event` request THEN the
  AO/event is deactivated (`is_active = false`), never hard-deleted, and no
  longer renders on the map.

## 5. Roles & authorization (RBAC)

Tiers from `packages/api/src/shared.ts`; per-org scoping via
`checkHasRoleOnOrg` (role on the org itself or any ancestor org — AO → Region
→ Sector → Area → Nation; `admin` satisfies `editor`).

| Action                                                    | Allowed                                                                                                      | Explicitly denied                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Enter map edit mode                                       | Any authenticated user                                                                                       | Anonymous (sign-in modal)                                                               |
| Submit any of the 12 request types (`protectedProcedure`) | Any authenticated user                                                                                       | Anonymous (UNAUTHORIZED)                                                                |
| Auto-apply on submit                                      | Submitter with `editor`/`admin` on **all** affected orgs (event org, locations' orgs, original + new region) | Any submitter lacking editor on ≥1 affected org → request is recorded `pending` instead |
| Load admin portal / Requests page                         | Any user with an `editor` or `admin` role                                                                    | Role `user` only → no-access redirect; anonymous → sign-in                              |
| List requests / view request detail (`editorProcedure`)   | Any editor/admin (default view scoped to own editable regions; nation admin sees all)                        | Non-editor authenticated users; anonymous                                               |
| Approve (`validateSubmissionByAdmin`, `editorProcedure`)  | Editor/admin of **all** orgs the change touches (same per-org check as auto-apply)                           | Editor of an unrelated region — the change does not apply                               |
| Reject (`rejectSubmission`, `editorProcedure`)            | Editor/admin of the request's region (or ancestor)                                                           | Editor of an unrelated region (UNAUTHORIZED)                                            |

## 6. Data & migrations

- Schema changes (Drizzle, PR #274): `request_type` enum replaced — old values
  (`create_location`, `create_event`, `edit`, `delete_event`) superseded by 12
  specific types plus legacy `edit`; `update_requests.event_name` made
  nullable. Migration `packages/db/drizzle/0015_even_thing.sql` drops and
  recreates the Postgres enum and casts the column.
- Backfill plan: existing rows keep their type (`edit` retained as a legacy
  value); the map UI prompts resubmission for legacy `edit` requests rather
  than rendering a modal for them.
- ⚠️ Human review required: the enum drop/recreate migration and the cast of
  existing `request_type` values must be verified against production data
  before merge (irreversible if old values are lost).

## 7. Out of scope / non-goals

- Anonymous (signed-out) submissions — sign-in is required by design.
- Reverting an approved request (no revert endpoint exists).
- Editing region/sector/area org records themselves (only AOs, locations,
  events).
- Rate limiting beyond the existing per-IP limiter; per-user submission caps.
- The admin app's other management surfaces (users, roles, event types).

## 8. Critical-path test cases (blocking tier)

1. Anonymous user cannot enter edit mode (AC-1).
2. Non-editor submit → pending request, no live data change (AC-8).
3. Editor submit → applied immediately, map updated (AC-9).
4. Admin approve applies (possibly edited) values to live tables (AC-12).
5. Admin reject → no live data change (AC-13).
6. Cross-region reject is denied (AC-15).
7. Invalid form values never reach the API (AC-5).

## 9. Observability

- Today: submission/approval paths log via `@acme/logger`; no dedicated
  metrics.
- To add (with the OTEL baseline work): counter events
  `request.submitted` (tagged pending/auto-applied), `request.approved`,
  `request.rejected`, `request.notification_failed` — enough to alert on
  review backlog and notification failures.

## 10. Open questions (resolve before final)

1. Request **detail** (`request.byId`) and the "Only Mine = off" list view are
   visible to editors of any region. Is cross-region read visibility intended,
   or should reads be scoped like rejects are?
2. Reject currently records no reviewer identity (`reviewed_by` /
   `reviewed_at` unset on reject). Should reviewer attribution be required for
   audit?
3. The reject confirmation toast renders in the error (red) style. Intended?
4. An editor approving a request they lack region permission for silently
   re-records it as `pending` (no error surfaced). Should the UI say so?

## 11. Human sign-off checklist

- [ ] Acceptance criteria approved by owner
- [ ] Security reviewed (authorization, not just authentication)
- [ ] Availability / reliability reviewed (multi-instance safe)
- [ ] Scalability reviewed (query cost, no DB-melting patterns)
