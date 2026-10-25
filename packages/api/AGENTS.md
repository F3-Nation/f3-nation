# Testing

`vitest.global-setup.ts` resets and re-seeds the database at `TEST_DATABASE_URL`
(`f3nation_test` locally, `f3_test` in CI) before the suite runs. This covers
`pnpm --filter @acme/api test`, `pnpm -C packages/api test`, and `turbo run
test` — all of which load `.env` via `with-env` — so no external reset step is
needed. A bare `vitest` invocation or most editor test runners bypass
`with-env`; without `TEST_DATABASE_URL` set, the reset silently no-ops instead
of running. `apps/api`'s characterization suite is unaffected; it still resets
through Turbo's `reset-test-db` task.

## Error Handling

Full rationale, the code-selection table, and the `catch`-block pattern:
[`docs/AI_DEVELOPMENT_GUIDE.md`](../../docs/AI_DEVELOPMENT_GUIDE.md#error-handling).

- Throw `new ORPCError(code, { message })`, never a raw `Error` — oRPC masks
  untyped throws as an opaque 500 and drops the message. Enforced by ESLint over
  `src/router` and `src/lib` (see `eslint.config.js`); the router delegates its
  apply path to `src/lib`, so a raw throw there is masked the same way.
- 4xx for client errors, `INTERNAL_SERVER_ERROR`/`BAD_GATEWAY` only for genuinely
  unexpected server or upstream failures.
- **`UNAUTHORIZED` covers both unauthenticated and insufficient-role** in this
  codebase; `FORBIDDEN` is used at only three sites. Use `UNAUTHORIZED` for
  permission checks, and do not file existing ones as miscoded — it is not a
  finding.
- **Never bare-rethrow in a `catch`.** No lint rule can catch `throw error`.
  Guard on `error instanceof ORPCError`, `logError` the original, then wrap in a
  generic `INTERNAL_SERVER_ERROR`.
- A missing row is only `NOT_FOUND` if the caller could have caused it. If the
  lookup key is boundary-constrained (a `z.enum`, a literal, session-derived), a
  miss means our data is wrong — that is `INTERNAL_SERVER_ERROR`.
- Map an FK violation to `CONFLICT`. Read the SQLSTATE with `getPgError` /
  `isForeignKeyViolationError` (`src/lib/user.ts`), which also checks
  `.cause`.
- Log ids and `Object.keys(changes)`, never request bodies or emails. Drizzle
  errors embed SQL and bound parameters, so don't log one raw when the query
  binds PII.

## Authorization

A procedure tier is not authorization. `protectedProcedure` proves a session;
`editorProcedure` and `adminProcedure` prove a role on _some_ org. More in
[`docs/AI_DEVELOPMENT_GUIDE.md`](../../docs/AI_DEVELOPMENT_GUIDE.md#api-authorization).

- Every read or write of a specific resource calls `checkHasRoleOnOrg` (or an
  equivalent) against the org of the **fetched DB row**, never an org id from
  input.
- A mutation that moves a record (`orgId`, `parentId`, `aoId`, `locationId`,
  `seriesId`, any foreign id) authorizes the caller on **both** source and
  destination. Use `requireEditorOnRescope`, which returns `NOT_FOUND` for a
  missing target before the permission check.
- Verify every foreign id in input exists, is active, and belongs to an org
  the caller can edit, before writing.
- Anonymous or `publicReadProcedure` paths:
  - Force `isActive` and `!isPrivate` on the row, its series and its full
    ancestor chain (`orgAndAncestorsAreActive` / `ancestorOrgsAreActive`),
    whatever filters the caller sends.
  - Select an explicit column allowlist (no emails, phones, `meta` or tokens).
  - Bound the page size.
- Put a joined table's active/private predicate in the `LEFT JOIN`, not in
  `WHERE`, which drops the base row.
- API-key sessions never inherit the key owner's privileges; self-edit and
  "is owner" shortcuts exclude them.
- No identity-based overrides (hard-coded emails, dev backdoors) in an
  authorization path.
- A refused write throws `ORPCError("UNAUTHORIZED")`. Never drop the refused
  fields and return success.

## Data correctness

- Every offset-paginated query ends its `ORDER BY` with a unique tiebreaker
  (`asc(table.id)`), including caller-supplied sorts and an empty sort array.
  `getSortingColumns` silently drops unknown sort ids.
- Partial updates (`crupdate`): omitted keys leave columns untouched, so give
  optional booleans no Zod `.default()`. `undefined` preserves a value and
  `[]` clears it. Apply insert defaults only in the insert branch.
- Related writes go in one `db.transaction`: entity plus join rows, audit
  record plus mutation, cascade plus instance regeneration.
- Claim one-time work (a "notified" marker) with one conditional
  `UPDATE … WHERE … RETURNING`, never read-then-write. Claim before sending,
  and release the claim only when the send definitely failed. For an
  ambiguous outcome (a timeout after the provider may have accepted it), keep
  the claim or use an idempotency key.
- Fire notifications, webhooks and cache revalidation only after every write
  commits.
- Org-tree logic is depth- and type-agnostic: use the shared walkers bounded
  by `ORG_TREE_MAX_DEPTH`, with a cycle guard, never fixed hops
  (`parent.parent`, aliased self-joins, region → area → sector). Compute a
  recursive set once and anti-join it; never put `WITH RECURSIVE` inside a
  per-row `EXISTS`.
- Never `exists(select count() …)`: an aggregate always returns a row, so the
  `EXISTS` is always true.
- Chunk any `IN` list built from client input: Postgres caps a query at
  65,535 bind parameters.
- Pin `orgType` in org self-joins. Keep active/status filters and returned
  fields the same across sibling procedures (`all`, `byId`, `byLocation`). A
  column added to a grouped select also goes in `groupBy`.
- Optional contact and URL fields `.trim()` and normalize empty to `null`.

## Contracts and callers

- Changing what an endpoint accepts, returns, defaults or paginates breaks
  callers. Grep for them and update or stay compatible in the same PR: the
  Slack bot's Python client (`apps/slackbot/infrastructure/api_client`, which
  sends `True`/`False`), the map, admin and me hooks, and `apps/homepage`.
  State any new 4xx in the PR.
- REST query parameters: use `queryBooleanSchema`, never
  `z.coerce.boolean()` (`"false"` becomes `true`) or a bare
  `z.coerce.number()` (`""` becomes `0`). Bound integer ids to
  `1..2147483647`. Validate date strings with `z.iso.date()` before comparing.
- Every new or changed procedure has an `.output()` schema with `.describe()`
  on each field. Output schemas strip unknown keys, so diff the returned
  fields. Derive enum lists and limits in descriptions from the shared
  constant. A delete returns `{ <entity>Id }`, not `z.void()`.
- A change to input or output schemas, descriptions, tags or security updates
  `apps/api/characterization/__snapshots__/openapi.golden.json` deliberately;
  call out the diff in the PR. Add a wire test when REST and RPC behavior can
  diverge.
- App-specific shapes (Slack, map) go in `router/slack.ts` or `router/map/`;
  core CRUD routers stay app-neutral.

## External calls

- Set an `AbortSignal` timeout that also covers reading the body, and check
  `res.ok` before parsing. Fan-outs use `Promise.allSettled`, so one failed
  target can't 500 the aggregate.
