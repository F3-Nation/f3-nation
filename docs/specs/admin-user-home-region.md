# Regional administrator home-region corrections

## 1. Summary

A signed-in administrator, or an API key whose own assigned roles provide
administrator access to a member's current home region, can correct that
member's home region to another active region without administering the
destination. A home-region correction changes membership information; it does
not grant roles or administrative access in the destination. Authorized corrections
supersede Slack home-region nudge preferences and do not notify the member;
the correction event records who made the change.

## 2. Context & links

- Apps affected: API and Admin.
- Server mutation: [user router](../../packages/api/src/router/user.ts).
- Permission checks: [organization roles](../../packages/api/src/check-has-role-on-org.ts).
- User interface: [Admin Users modal](../../apps/admin/src/app/_components/modal/admin-users-modal.tsx).
- Regression coverage: [user scope tests](../../packages/api/src/router/user-crupdate-scope.test.ts).

## 3. User stories

- As a regional administrator, I can correct the home region of a member
  currently assigned to my region so regional reporting reflects their home.
- As an API client with administrator access assigned to its key, I can make
  the same correction within that key's authorized region.
- As a member, my roles and private information retain their existing access
  protections when an administrator corrects my home region.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an existing member homed in region A and either a signed-in
  person or an API key with its own administrator access to A, WHEN that caller
  saves active region B as the member's home region, THEN the persisted home region is B even without
  editing rights in B. Administrators of an ancestor organization
  (area, sector or nation) also qualify through existing role inheritance.
- **AC-2** — GIVEN an administrator with no administrator access to the member's
  current home region, WHEN they attempt to use this exception, THEN the request
  is rejected and the member's record is unchanged.
- **AC-3a** — GIVEN a human or API-key session with only editor access to A
  and no editing rights in B, WHEN it attempts the move, THEN it receives
  `UNAUTHORIZED` and the member and roles remain unchanged.
- **AC-3b** — GIVEN an API key with its own administrator access to A, WHEN
  it moves a member from A to valid region B, THEN the move succeeds without
  destination editing rights, subject to the same validation as a human admin.
- **AC-3c** — GIVEN an API key without its own qualifying permissions, WHEN
  its owner administers A, THEN the owner's roles do not authorize the key's
  move; the request receives `UNAUTHORIZED` and persists nothing.
- **AC-4** — GIVEN any `user.crupdate` request assigning a changed, non-null
  home region, including self-edit, editor-of-both, administrator-exception
  and initial placement paths, WHEN the destination is missing, THEN return
  `NOT_FOUND`; WHEN it is not a region or it or an ancestor is inactive, THEN
  return `BAD_REQUEST`. Reject atomically without changing the user or roles.
  Skip destination validation when the value is unchanged, so a member homed
  in a now-inactive region remains editable. Clearing to `null` retains its
  existing rules and is outside this change.
- **AC-5** — GIVEN a permitted correction, WHEN the request also attempts an
  unauthorized role change, THEN the whole request is rejected. A successful
  correction does not create, transfer or remove roles implicitly and does not
  expand access to private profile fields.
- **AC-6** — GIVEN a new user or an existing user without a home region, WHEN an
  administrator attempts to place them outside their editable regions, THEN
  this exception does not apply. Existing self-edit and authorized
  source-and-destination editor permissions remain unchanged; changed
  non-null destinations are subject to AC-4.
- **AC-7** — GIVEN an administrator changing an existing member's home region
  in the Admin Users form, WHEN they save, THEN a confirmation names the
  destination and warns that they may lose profile-edit access after the move.
  Cancelling submits no mutation; confirming submits the chosen destination,
  which is visible on a subsequent authorized read. The existing region picker
  already lists regions and needs no expansion. The warning must not claim
  that callers with other qualifying permissions necessarily lose access.
- **AC-8** — GIVEN the member's home region changes after the exception is
  authorized but before its write, WHEN the stale request attempts to save,
  THEN it receives `CONFLICT` without overwriting the newer home region or
  changing roles. Guard the upsert against the previously read home region;
  a zero-row result from that guard is a conflict, not a generic save failure.
- **AC-9** — GIVEN a successful home-region correction, THEN emit an info-level
  event identifying the actor, API key when present, affected user, and old and
  new organization IDs. A rejected or rolled-back correction emits no success
  event. Do not include names, email addresses or other private profile data.

- **AC-10** — GIVEN a member who chose “No, keep current” on a Slack
  home-region nudge or has `home_region_nudge_opt_out` set, WHEN a signed-in
  administrator or API key makes an otherwise authorized correction, THEN
  the correction succeeds subject to the same permission, destination and
  concurrency checks. Neither nudge preference blocks the correction or
  requires additional member agreement.
- **AC-11** — GIVEN a successful administrator home-region correction through
  a human or API-key session, THEN no member notification is sent or queued,
  including through Slack or email. The attribution event required by AC-9
  is still emitted.

### Member preference and notification policy

An authorized administrator correction supersedes the member's Slack
home-region nudge preferences. Those preferences govern automated nudges,
not the administrator's permission to correct a home region. This exception
also applies to API keys with their own qualifying administrator roles.

Corrections do not notify the member. They are expected to be infrequent,
and notification delivery adds overhead without enough benefit for this
scope. Accountability is provided by the correction event identifying who
made the change. No notification delivery or failure-handling flow is required.

## 5. Roles & authorization (RBAC)

`user.crupdate` retains its `editorProcedure` tier and existing profile, PII and
role checks. The exception is checked against the existing user's stored home
region, never a caller-supplied source region. It applies only to changing an
existing non-null home region to another valid region, using a human session
or an API-key session with administrator access to the stored source region.
For an API key, permission checks use only the key's assigned organization
roles, including their existing hierarchy inheritance, never its owner's
personal roles. Key ownership does not create a self-edit exception.

| Action                                                                 | Allowed                                                                                                                  | Explicitly denied                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Move an existing member from A to B without destination editing rights | Signed-in administrator of A or API key with its own administrator access to A, including existing hierarchy inheritance | Unrelated administrators, source-only editors, keys relying only on their owner's permissions |
| Create or place a user without a home region in B                      | Existing creation and profile rules, including destination editing rights                                                | Using the new exception to bypass those rules                                                 |
| Grant or remove roles during a correction                              | Existing administrator checks on each role's organization                                                                | Treating the home-region correction as authorization for role changes                         |
| Change other profile fields or read private information                | Existing profile and PII rules                                                                                           | Any additional privilege inferred from the exception                                          |

This is a narrow exception to requiring permission in both source and
destination for a cross-organization move. Other resource moves retain that
requirement.

## 6. Out of scope / non-goals

- Bulk corrections, discrepancy-report integration and automatic re-homing.
- Member notifications for administrator corrections, including Slack and email.
- Changing automated nudge behavior or adding durable refusal tracking to gate
  administrator corrections.
- Changing user-creation or self-service profile permissions, API-key role assignment or the separation between key permissions
  and owner permissions. Destination validation under AC-4 still applies.
- Moving organizational roles, granting destination access or transferring
  Slack identities or historical attendance.
- Changing the existing permission to clear a home region to `null`.
- Database schema changes, deployment or production data changes.

## 7. Critical-path test cases

- A source-region administrator selects B in the existing Admin form, confirms,
  and the member's persisted home region becomes B with unchanged roles.
- An API key with its own source-region administrator role performs the same
  move without destination access; the persisted home region changes and roles
  remain unchanged.
- A source-only editor and an unrelated administrator cannot perform that move.
- An API key without its own source-region administrator access is rejected
  even when its owner administers that region; the member remains unchanged.
- Missing destinations return `NOT_FOUND`; non-region or inactive destinations
  return `BAD_REQUEST` on every changed non-null destination path. An unchanged
  inactive home region does not block otherwise authorized profile edits.
- Invalid destination and unauthorized role-change requests persist nothing.
- Cancelling the confirmation submits no mutation; its destination and warning
  match the proposed move.
- Preserve the existing source-only editor denial regression.
- For both human administrators and API keys with qualifying roles, verify
  otherwise valid corrections succeed for members with the nudge opt-out set
  and after a declined nudge, as well as members without those preferences.
  Existing authorization, destination validation and stale-write checks still apply.
- Verify successful human- and API-key-initiated corrections send or queue no
  member notification, including Slack or email, while producing the required
  attribution event.
- Successful corrections produce the required attribution event; failed or
  rolled-back corrections produce no success event.
- A stale correction returns `CONFLICT` and cannot overwrite an intervening
  home-region change or mutate roles.

## 8. Observability

- Add an info-level correction event after a successful transaction with actor
  ID, API key ID when present, affected user ID, and from/to organization IDs.
- Return `UNAUTHORIZED` for insufficient permissions, `NOT_FOUND` for a missing
  destination, `BAD_REQUEST` for a non-region or inactive destination, and
  `CONFLICT` for a stale guarded write. Do not silently drop a refused correction
  and report success.
- Do not add names, emails or other private profile data to logs.
