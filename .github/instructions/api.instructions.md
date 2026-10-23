---
applyTo: "packages/api/**,apps/api/**,packages/validators/**"
---

# API (oRPC routers, handlers, REST host)

Background: `docs/AI_DEVELOPMENT_GUIDE.md` (authorization, error handling) and
`packages/api/AGENTS.md`.

## Authorization

- A procedure tier is not authorization. `protectedProcedure` proves a
  session; `editorProcedure` and `adminProcedure` prove a role on _some_ org.
  Every read or write of a specific resource must call `checkHasRoleOnOrg`, or
  an equivalent, against the org of the **fetched DB row**, never an org id
  from input.
- Mutations that move a record (`orgId`, `parentId`, `aoId`, `locationId`,
  `seriesId`, any foreign id) must authorize the caller on **both** source and
  destination. Use `requireEditorOnRescope`, which checks the target exists
  (`NOT_FOUND`) before the permission check.
- Any foreign id in input must be verified to exist, be active, and belong to
  an org the caller can edit, before writing.
- Anonymous or `publicReadProcedure` paths:
  - Force `isActive` and `!isPrivate` on the row, its series and its full
    ancestor chain (`orgAndAncestorsAreActive` / `ancestorOrgsAreActive`),
    whatever filters the caller supplies.
  - Select an explicit column allowlist (no emails, phones, `meta` or tokens).
  - Bound the page size.
- Put a joined table's active/private predicate in the `LEFT JOIN`, not in
  `WHERE`, which drops the base row.
- API-key sessions never inherit the key owner's privileges. Self-edit and
  "is owner" shortcuts must exclude them.
- No identity-based overrides (hard-coded emails, dev backdoors) in an
  authorization path.
- A refused write throws `ORPCError("UNAUTHORIZED")`. Never drop the refused
  fields silently and return success.

## Errors and logging

- Throw `ORPCError(code, { message })`, never a raw `Error`; oRPC masks it
  as an opaque 500. In `catch`, pass an `ORPCError` through, otherwise
  `logError` and wrap it (`BAD_GATEWAY` upstream, else
  `INTERNAL_SERVER_ERROR`). Use `NOT_FOUND` only when the caller could cause
  the miss.
- Map an FK violation to `CONFLICT`; read the SQLSTATE with `getPgError` /
  `isForeignKeyViolationError` (`lib/user.ts`), which also checks `.cause`.
- Log ids and `Object.keys(changes)`, never request bodies or emails. Drizzle
  errors embed SQL and bound parameters (PII); don't log one raw when the
  query binds PII.

## Data correctness

- Every offset-paginated query ends its `ORDER BY` with a unique tiebreaker
  (`asc(table.id)`), including caller-supplied sorts and an empty sort array.
  `getSortingColumns` silently drops unknown sort ids.
- Partial updates (`crupdate`):
  - Omitted keys leave columns untouched; give optional booleans no Zod
    `.default()`.
  - `undefined` preserves a value and `[]` clears it.
  - Apply insert defaults only in the insert branch.
- Related writes go in one `db.transaction`: entity plus join rows, audit
  record plus mutation, cascade plus instance regeneration.
- Claim one-time work (a "notified" marker) with one conditional
  `UPDATE ... WHERE ... RETURNING`, never read-then-write. Claim before
  sending; release the claim only when the send definitely failed. For an
  ambiguous outcome (a timeout after the provider may have accepted it), keep
  the claim or use an idempotency key.
- Fire notifications, webhooks and cache revalidation only after every write
  commits.
- Org-tree logic is depth- and type-agnostic. Use the shared walkers bounded
  by `ORG_TREE_MAX_DEPTH`, with a cycle guard. Never chain fixed hops
  (`parent.parent`, aliased self-joins, region->area->sector).
  - Compute a recursive set once and anti-join it; never put
    `WITH RECURSIVE` inside a per-row `EXISTS`.
- Never `exists(select count() ...)`: an aggregate always returns a row, so
  `EXISTS` is always true.
- Chunk any `IN` list built from client input: Postgres caps a query at
  65,535 bind parameters.
- Pin `orgType` in org self-joins. Keep the same active/status filters and
  returned fields across sibling procedures (org-chart `all`, `byId`,
  `byLocation`). A column added to a grouped select also goes in `groupBy`.
- Optional contact and URL fields `.trim()` and normalize empty to `null`.

## Contracts and callers

- Changing what an endpoint accepts, returns, defaults or paginates breaks
  callers. Grep for them and update or stay compatible in the same PR:
  - `apps/slackbot/infrastructure/api_client` (Python `requests` sends
    `True`/`False`).
  - The map, admin and me hooks, and `apps/homepage`.
  - State any new 4xx in the PR.
- REST query parameters:
  - Use `queryBooleanSchema`, never `z.coerce.boolean()` (`"false"` becomes
    `true`).
  - Never a bare `z.coerce.number()` (`""` becomes `0`).
  - Bound integer ids to `1..2147483647`.
  - Validate date strings with `z.iso.date()` before comparing them.
- Every new or changed procedure has an `.output()` schema with `.describe()`
  on each field:
  - Output schemas strip unknown keys, so diff the returned fields.
  - Derive enum lists and limits in descriptions from the shared constant.
  - A delete returns `{ <entity>Id }`, not `z.void()`.
- Any change to input or output schemas, descriptions, tags or security
  updates `apps/api/characterization/__snapshots__/openapi.golden.json`
  deliberately; call the diff out in the PR. Add a wire test when REST and
  RPC behavior can diverge.
- New app-specific shapes (Slack, map) go in `router/slack.ts` or
  `router/map/`; core CRUD routers stay app-neutral.

## External calls

- Set an `AbortSignal` timeout that also covers reading the body. Check
  `res.ok` before parsing. Fan-outs use `Promise.allSettled`, so one failed
  target cannot 500 the aggregate.
