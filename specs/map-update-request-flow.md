# Map edit mode & update requests

> Human designer: Declan Nishiyama (@dnishiyama)

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
- Key code: `packages/api/src/router/request.ts`,
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
  THEN an update marker is placed offering the three placement request types —
  "New location, AO, & event", "Move existing AO here", "Move existing event
  here" — and a control to clear the marker.
- **AC-4** — GIVEN edit mode with a location selected WHEN the user opens the
  AO or event menus THEN the location-scoped request types are reachable: AO
  menu → edit AO details, move AO to different location, move AO to different
  region, delete AO; event menu → edit workout details, move to different AO,
  move to a new AO, delete workout; plus "Add Workout to AO" (create event).
  Each opens its request modal prefilled with current values. (These nine plus
  the three placement types in AC-3 are the full request surface; there is no
  standalone location create/edit/delete — locations are always handled through
  an AO or event request.)

### Forms & validation

- **AC-5** — GIVEN any request modal WHEN a required field is invalid per its
  schema (event name < 3 chars, start/end time not 24-hour `HHmm`, no event
  type selected, AO name < 2 chars, AO website not a URL, location
  address < 5 chars, missing lat/lng) THEN a field-level error is shown and
  submission is blocked with no API call. (The logo is not editable from the
  map — it is shown read-only and changed only in Admin — so there is no
  user-entered logo URL to validate here.)
- **AC-6** — GIVEN a signed-in user with a session email WHEN a request modal
  opens THEN the "Your Email" field is prefilled with that email and disabled.

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
  changes**, a confirmation toast appears in success/neutral styling (not the
  error style), and the row leaves the default pending view.
- **AC-14** — GIVEN a signed-in user whose only role is `user` WHEN they
  navigate to the admin app THEN they are redirected to the no-access page and
  cannot reach the Requests page.
- **AC-15** — GIVEN an editor of region R WHEN they attempt to reject a
  request belonging to region S (outside their editable orgs) THEN the API
  responds UNAUTHORIZED and the request remains `pending`.
- **AC-16** — GIVEN an approved `delete_ao` or `delete_event` request THEN the
  AO/event (and, for `delete_ao`, its events) are deactivated
  (`is_active = false`), never hard-deleted, and no longer render on the map.
- **AC-17** — GIVEN an editor clicks Approve on a request that touches a region
  they cannot edit WHEN the approval is processed THEN it is not applied — it
  is re-recorded `pending` for a scoped reviewer, and the UI tells the approver
  it was submitted for further review rather than showing "Approved update".

## 5. Roles & authorization (RBAC)

Tiers from `packages/api/src/shared.ts`; per-org scoping via
`checkHasRoleOnOrg` (role on the org itself or any ancestor org — AO → Region
→ Sector → Area → Nation; `admin` satisfies `editor`).

| Action                                                   | Allowed                                                                                                                          | Explicitly denied                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Enter map edit mode                                      | Any authenticated user                                                                                                           | Anonymous (sign-in modal)                                                                                                                 |
| Submit any request type (`protectedProcedure`)           | Any authenticated user                                                                                                           | Anonymous (UNAUTHORIZED)                                                                                                                  |
| Auto-apply on submit                                     | Submitter with `editor`/`admin` on **all** affected orgs (event org, locations' orgs, original + new region)                     | Any submitter lacking editor on ≥1 affected org → request is recorded `pending` instead                                                   |
| Load admin portal / Requests page                        | Any user with an `editor` or `admin` role                                                                                        | Role `user` only → no-access redirect; anonymous → sign-in                                                                                |
| List requests / view request detail (`editorProcedure`)  | Any editor/admin — cross-region read visibility is intended (default view scoped to own editable regions; nation admin sees all) | Non-editor authenticated users; anonymous                                                                                                 |
| Approve (`validateSubmissionByAdmin`, `editorProcedure`) | Editor/admin of **all** orgs the change touches (same per-org check as auto-apply)                                               | Editor lacking scope on ≥1 affected org — the change is **not** applied; it is re-recorded `pending` and surfaced to the approver (AC-17) |
| Reject (`rejectSubmission`, `editorProcedure`)           | Editor/admin of the request's region (or ancestor)                                                                               | Editor of an unrelated region (UNAUTHORIZED); request stays `pending`                                                                     |

## 6. Data & migrations

- Schema changes (Drizzle): the `request_type` enum is replaced — old values
  (`create_location`, `create_event`, `edit`, `delete_event`) superseded by the
  specific per-action types plus a retained legacy `edit`; `update_requests.event_name`
  becomes nullable. Migration `packages/db/drizzle/0015_even_thing.sql` drops
  and recreates the Postgres enum and casts the column.
- ⚠️ Human review required: the enum drop/recreate migration and the cast of
  existing `request_type` values must be verified against production data
  before merge (irreversible if old values are lost). Legacy `edit` requests
  are prompted for resubmission in the UI rather than rendered.

## 7. Out of scope / non-goals

- Anonymous (signed-out) submissions — sign-in is required by design.
- Reverting an approved request (no revert endpoint exists).
- Editing region/sector/area org records themselves (only AOs, locations,
  events).
- Rate limiting beyond the existing per-IP limiter; per-user submission caps.
- The admin app's other management surfaces (users, roles, event types).
- Mandatory reviewer attribution on approve/reject (`reviewed_by` stays
  optional for now; may revisit for audit later).

## 8. Critical-path test cases

1. Anonymous user cannot enter edit mode (AC-1).
2. Non-editor submit → pending request, no live data change (AC-8).
3. Editor submit → applied immediately, map updated (AC-9).
4. Admin approve applies (possibly edited) values to live tables (AC-12).
5. Admin reject → no live data change (AC-13).
6. Cross-region reject is denied, request stays pending (AC-15).
7. Invalid form values never reach the API (AC-5).

## 9. Observability

- Today: submission/approval paths log via `@acme/logger`; no dedicated
  metrics.
- To add (with the OTEL baseline work): counter events
  `request.submitted` (tagged pending/auto-applied), `request.approved`,
  `request.rejected`, `request.notification_failed` — enough to alert on
  review backlog and notification failures.
