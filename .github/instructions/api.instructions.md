---
applyTo: "packages/api/**,apps/api/**,packages/validators/**"
---

# API (oRPC routers, handlers, REST host)

Background: `docs/AI_DEVELOPMENT_GUIDE.md` (authorization, error handling) and
`packages/api/AGENTS.md`.

## Authorization

- A procedure tier is not authorization. `protectedProcedure`,
  `editorProcedure` and `adminProcedure` only prove a role exists _somewhere_.
  Every read or write of a specific resource must call `checkHasRoleOnOrg`, or
  an equivalent, against the org of the **fetched DB row**. Never use an
  org id taken from input.
- Mutations that move a record (`orgId`, `parentId`, `aoId`, `locationId`,
  `seriesId`, any foreign id) must authorize the caller on **both** the
  source and the destination. Use `requireEditorOnRescope`. Check that the
  target exists (`NOT_FOUND`) before the permission check.
- Any foreign id accepted in input must be verified to exist, be active, and
  belong to an org the caller can edit, before writing.
- Anonymous or `publicReadProcedure` paths:
  - Force `isActive` and `!isPrivate` on the row, its series and its full
    ancestor chain (`orgAndAncestorsAreActive` / `ancestorOrgsAreActive`),
    whatever filters the caller supplies.
  - Select an explicit column allowlist (no emails, phones, `meta` or tokens).
  - Bound the page size.
  - Reject unknown slugs or keys before touching the DB or a cache.
- Put a joined table's active/private predicate inside the `LEFT JOIN`, not
  in `WHERE`. A `WHERE` on the joined table drops the base row.
- API-key sessions never inherit the key owner's privileges. Self-edit and
  "is owner" shortcuts must exclude API-key sessions.
- Never add identity-based overrides (hard-coded emails, dev backdoors) to an
  authorization path.
- A refused write throws `ORPCError("UNAUTHORIZED")`. Never drop the refused
  fields silently and return success.

## Errors and logging

- Throw `ORPCError(code, { message })`, never a raw `Error`. oRPC turns
  untyped throws into an opaque 500.
- In `catch`, pass an existing `ORPCError` through. Otherwise `logError` the
  original and wrap it:
  - `BAD_GATEWAY` for upstream failures.
  - `CONFLICT` for FK violations; read the SQLSTATE from
    `err.cause?.code ?? err.code`.
  - `INTERNAL_SERVER_ERROR` for everything else.
- Use `NOT_FOUND` only when the caller could have caused the miss. A miss on
  a literal, enum or session-derived key is our bug, so it is
  `INTERNAL_SERVER_ERROR`.
- Log ids and `Object.keys(changes)`, never request bodies, emails, or raw
  Drizzle errors (bound parameters carry PII).

## Data correctness

- Every offset-paginated query ends its `ORDER BY` with a unique tiebreaker
  (`asc(table.id)`). This applies to caller-supplied sorts and to an empty
  sort array too. `getSortingColumns` drops unknown sort ids silently.
- Partial updates (`crupdate`):
  - Omitted keys leave columns untouched; give optional booleans no Zod
    `.default()`.
  - `undefined` preserves a value and `[]` clears it.
  - Apply insert defaults only in the insert branch.
- Related writes go in one `db.transaction`: entity plus join rows, audit
  record plus mutation, cascade plus instance regeneration.
- Claims and attempt counters use one conditional
  `UPDATE … WHERE … RETURNING`, never read-then-write.
- Fire notifications, webhooks and cache revalidation only after every write
  commits. Set "already notified" flags only after the send succeeds.
- Org-tree logic is depth- and type-agnostic. Use the shared walkers bounded
  by `ORG_TREE_MAX_DEPTH`, with a cycle guard. Never chain fixed hops
  (`parent.parent`, aliased self-joins, region→area→sector).
  - Compute a recursive set once and anti-join it; never put
    `WITH RECURSIVE` inside a per-row `EXISTS`.
- Never use `exists(select count() …)`: an aggregate always returns a row, so
  `EXISTS` is always true.
- Don't call authorization helpers in a loop over orgs; batch them. Chunk any
  `IN` list built from client input, because Postgres caps a query at 65,535
  bind parameters.
- Pin `orgType` in org self-joins, and keep the same active/status filters
  and returned fields across sibling procedures (`all`, `byId`,
  `byLocation`). A column added to a grouped select is also added to
  `groupBy`.
- Optional contact and URL fields `.trim()` and normalize empty to `null`, so
  clearing a field stores `null`, not `""`.

## Contracts and callers

- Changing what an endpoint accepts, returns, defaults or paginates breaks
  callers. Grep for them and update or keep compatibility in the same PR:
  - `apps/slackbot/infrastructure/api_client` (Python sends `True`/`False`).
  - The map/admin/me hooks.
  - `apps/homepage`.
  - State any new 4xx in the PR.
- REST query parameters:
  - Never use `z.coerce.boolean()` (`"false"` becomes `true`).
  - Never use a bare `z.coerce.number()` (`""` becomes `0`).
  - Bound integer ids to `1..2147483647`.
  - Validate date strings with `z.iso.date()` before comparing them.
- Every new or changed procedure has an `.output()` schema with `.describe()`
  on each field:
  - Output schemas strip unknown keys, so diff the returned fields.
  - Derive enum lists and limits in descriptions from the shared constant,
    never hand-written.
  - A delete returns `{ <entity>Id }`, not `z.void()`.
- Any change to input or output schemas, descriptions, tags or security
  requires regenerating
  `apps/api/characterization/__snapshots__/openapi.golden.json`. Add a wire
  test when REST and RPC behavior can diverge.
- Keep app-specific shapes (Slack, map) in their sub-routers. Core CRUD
  routers stay app-neutral.

## External calls

- Set an `AbortSignal` timeout that also covers reading the body. Check
  `res.ok` before parsing. Fan-outs use `Promise.allSettled`, so one failed
  target cannot 500 the aggregate.
