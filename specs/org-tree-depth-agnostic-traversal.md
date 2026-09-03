# Depth-agnostic organization tree traversal

> Human designer: Crash (Andy Pickler); tracked in
> [F3-Nation/f3-nation#917](https://github.com/F3-Nation/f3-nation/issues/917)

## 1. Summary

Replace the API's three fixed-depth organization-tree queries with recursive,
depth-guarded database queries. The change preserves authorization and list
filtering behavior for the current five-level hierarchy while allowing those
queries to reach a sixth level and terminating safely if malformed data contains
a cycle.

## 2. Context & links

- App affected: API (`packages/api`)
- Epic: [F3-Nation/f3-nation#855](https://github.com/F3-Nation/f3-nation/issues/855)
- Child issue:
  [F3-Nation/f3-nation#917](https://github.com/F3-Nation/f3-nation/issues/917)
- Key code:
  - `packages/api/src/check-has-role-on-org.ts`
  - `packages/api/src/get-editable-org-ids.ts`
  - `packages/api/src/get-descendant-org-ids.ts`

## 3. User stories

- As an administrator or editor, I want inherited organization permissions to
  reach every descendant so that adding a hierarchy level does not silently
  remove access.
- As an API consumer, I want organization-scoped list endpoints to include all
  descendants so that adding a hierarchy level does not silently omit records.
- As an operator, I want malformed cyclic hierarchy data to produce bounded
  query work so that traversal cannot recurse indefinitely.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN the current five-level hierarchy WHEN
  `checkHasRoleOnOrg` checks a direct role, an inherited ancestor role, a
  non-matching role, or a missing session THEN its result is identical to the
  fixed-depth implementation.
- **AC-2** — GIVEN the current five-level hierarchy WHEN
  `getEditableOrgIdsForUser` evaluates database-backed admin/editor roles THEN
  it returns the same unique, non-AO editable organizations and the same
  `isNationAdmin` value as the fixed-depth implementation.
- **AC-3** — GIVEN one or more parent organizations in the current five-level
  hierarchy WHEN `getDescendantOrgIds` runs THEN it returns the same unique set
  containing each existing input organization and all descendants as the
  fixed-depth implementation; an empty input still returns an empty array.
- **AC-4** — GIVEN a synthetic six-node hierarchy chain WHEN each traversal
  function runs THEN it reaches the sixth node in its traversal direction.
- **AC-5** — GIVEN cyclic hierarchy data WHEN each traversal function runs THEN
  its visited-path guard terminates the cycle, it returns only unique reachable
  organizations, and it does not report that the depth limit was reached.
- **AC-6** — GIVEN an organization-scoped list call in `location.ts`,
  `event.ts`, `position.ts`, `org.ts`, or `map/event.ts` WHEN editable scope is
  expanded THEN it traverses once from the user's direct editable roots, so the
  configured depth limit is applied once; endpoint input and output schemas
  remain unchanged. A non-nation `onlyMine` call with no database-backed
  editable scope returns an empty result, including the corrected
  `position.all` behavior that previously omitted its scope filter. The user
  list continues to traverse once from its requested roots.
- **AC-7** — GIVEN the three completed implementations WHEN their source is
  inspected THEN each uses a parameterized recursive CTE with a depth guard and
  no fixed-depth `aliasedTable` ladder remains.

## 5. Roles & authorization (RBAC)

This is a behavior-preserving authorization refactor. It does not introduce a
new endpoint, role, or permission rule.

| Action                                                         | Allowed                                                                                                                  | Explicitly denied                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Pass `checkHasRoleOnOrg` for a requested role                  | A session with that role or `admin` on the target organization or any ancestor                                           | Missing session, no matching role, or a matching role only on an unrelated organization |
| Receive editable organization IDs                              | A database-backed `admin` or `editor` assignment on an organization; descendant non-AO organizations inherit editability | Authenticated users without a database-backed `admin` or `editor` assignment            |
| Receive unfiltered nation-wide results through `isNationAdmin` | A database-backed nation-level `admin` or `editor` assignment, preserving current behavior                               | Assignments below nation level and users without an editable role                       |

The current nation-level `editor` behavior is intentionally preserved. Deciding
whether nation-wide access should become admin-only is human-owned RBAC work and
is out of scope for #917.

## 6. Out of scope / non-goals

- Adding the `territory` enum value or migrating production hierarchy data.
- Changing which roles inherit permissions or which organization types are
  editable.
- Changing endpoint schemas, response ordering guarantees, or caller behavior.
- Validating parent/child organization types or preventing self-parent and
  descendant-parent assignments; that hierarchy-integrity work belongs to
  [#918](https://github.com/F3-Nation/f3-nation/issues/918). This includes
  preventing a privileged user from creating an invalid nation child and then
  gaining nation-wide access through the existing inherited-role rules.
- Changing the hard-coded notification escalation ladder, or hardening its
  separate recursive helper against cycles; that work belongs to
  [#926](https://github.com/F3-Nation/f3-nation/issues/926).
- Unifying user-role and API-key-role resolution. This change preserves the
  existing database-backed user-role lookup used by organization-scoped list
  endpoints; broader principal resolution is separate authorization work.
- Refactoring the already depth-agnostic traversal in `org-chart/index.ts`.

## 7. Critical-path test cases

- A role on the root authorizes access to the sixth/deepest descendant.
- An inherited editor role permits editor access but not admin access, and a
  descendant role does not grant access to an ancestor.
- A root editable role includes the sixth/deepest non-AO descendant.
- Descendant lookup from the root includes the sixth/deepest node; overlapping
  input roots do not produce duplicates.
- List scoping traverses from direct editable roots and cannot compound two
  depth budgets.
- Each traversal terminates against a cycle and does not return duplicates.
- Editable traversal includes an AO role root, but does not recurse through an
  AO child to malformed non-AO descendants.
- Overlapping editable role roots do not produce duplicate organizations.
- Existing five-level authorization success and denial cases remain unchanged.

## 8. Observability

- Preserve the existing structured debug event names while retaining only safe
  aggregate context.
- Emit `api.org_tree.depth_limit_reached` at error level only when a node is
  reachable one level beyond the configured return boundary, so the event is
  forwarded to the configured error reporter. Include only traversal direction,
  source, root count, and maximum depth; do not log organization or user
  identifiers.
