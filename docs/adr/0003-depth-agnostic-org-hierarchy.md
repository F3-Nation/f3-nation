# ADR 0003: Depth-agnostic organization hierarchy traversal

- **Status:** Accepted
- **Date:** 2026-09-12
- **Deciders:** @BigGillyStyle

## Context

### The triggering change

F3 organizes itself as a tree of orgs — **nation → sector → area → region → AO**
— and decided to add a sixth tier, **territory**, between sector and area. The
work is tracked in
[#855](https://github.com/F3-Nation/f3-nation/issues/855).

The database was already built for this. Every org is a row in `orgs` with a
`parent_id`, so the schema does not care how deep the tree goes. Adding a tier
is, at the storage layer, one new enum member plus re-parenting some rows.

The application code was not built for this. An audit found **six** places that
assumed a five-deep tree by hand-writing one step per level. None of them threw,
and none logged. Each returned quietly wrong results.

### Why the failures were invisible

A `LEFT JOIN` that runs out of tree yields `NULL`, and the callers filtered
nulls away before use. A truncated ancestor chain was therefore
indistinguishable from a legitimately short one. Two of the six governed
authorization, so the symptom would have been administrators silently losing
access to orgs they owned.

One variant was worse. The org map (then a separate repo) ran unrecognized org
types through a fallback that coerced them into a _valid_ value, so a territory
would have been rendered as a sector. A defensive default intended to make bad
input safe is what destroyed the evidence that anything had gone wrong.

### What the audit got wrong about itself

The catalogue began at three entries and was twice incomplete:

- `getDescendantOrgIds` was missed because the audit anchored on "who can edit
  what," and it reads as a generic helper. It had the widest blast radius of
  all six — eight call sites across six routers.
- `ancestorOrgsAreActive`
  ([#965](https://github.com/F3-Nation/f3-nation/issues/965)) was missed because
  it landed via a long-lived branch opened before the audit, so it was never in
  the tree that was audited.

This is a property of the pattern, not a lapse in diligence: a fixed-depth join
ladder is ordinary-looking code that only misbehaves when a constant changes far
away from it.

## Decision

**The org tree's depth is never encoded in code. Anything that needs to walk it
does so recursively, bounded by a shared depth cap.**

Four rules follow.

### 1. One ordered array is the source of truth

`OrgType` in `packages/shared/src/app/enums.ts` is an ordered leaf → root array.
Rank, parent validity, display labels, admin route segments, and icons all
derive from it. Its order is load-bearing — rank is the array index, and that
index must match the Postgres enum's declared sort order.

Two compile-time tripwires protect this:

- `AssertOrgTypeOrder` pins the exact tuple, so an accidental re-sort fails
  typecheck.
- `orgTypeDisplay` and `orgAdminConfig` are `Record<OrgType, …>`, so a new tier
  cannot be added without supplying its metadata.

These convert what would be silent gaps into build failures. That is the point:
this ADR exists because silent gaps are the failure mode of the thing it
replaces.

### 2. Traversal is recursive, not positional

Ancestor and descendant walks use recursive CTEs with a depth guard
(`ORG_TREE_MAX_DEPTH`, `packages/api/src/org-tree.ts`) rather than a fixed
number of aliased self-joins. The guard bounds runaway recursion if data ever
contains a cycle.

drizzle-orm is pinned at 0.45.2, which does not expose `withRecursive`, so these
are raw `sql` templates.

One deliberate exception to shape, not to principle: `ancestorOrgsAreActive`
walks _down_ from every inactive org rather than _up_ from the row in hand, and
stays an inline subquery rather than a `db.execute`. It is embedded via
`notExists(...)` inside bulk selects; an ancestor-anchored form would correlate
the CTE and re-run it per row (~14× slower at 5k rows), and a separate call
would be an N+1.

### 3. Parent validation is ordinal, not adjacent

A parent is valid when `rank(parent) > rank(child)` — _somewhere above_, not
_exactly one above_.

This is forced by the rollout: territories are created gradually, so an area may
sit under a territory or still directly under a sector, indefinitely. Adjacency
would reject every un-migrated area. It also rules out expressing the rule as a
database `CHECK` constraint.

### 4. Unknown org types fail loudly — but dangling parents do not

Code that meets an org type it does not recognize must **not** substitute a
plausible one. `normalizeOrgType` returns `null`.

The deliberate exception is _re-parenting_: when a client drops an unrecognized
ancestor, it must re-link that ancestor's children to the nearest recognized
ancestor rather than leave a `parent_id` pointing at an org it discarded. The
alternative to guessing is not "no guess" — it is a dangling pointer, which
orphans the whole subtree. Attaching to a known-real ancestor degrades to an
incomplete-but-coherent tree.

This distinction matters most for statically-exported clients, which carry a
build-time snapshot of the enum while reading a live API that may already be
ahead of them.

## Alternatives considered

**Add the tier and fix what breaks.** Rejected: all six failures are silent, so
"what breaks" would have surfaced as user reports of missing access weeks later,
with no error to trace. The traversal rewrites deliberately landed _while the
tree was still five deep_, so they could be proven behavior-preserving against
known-good output before the variable changed.

**`ALTER TYPE … ADD VALUE` for the enum.** Rejected: it appends, so the enum's
sort order would no longer match the TypeScript array's index order, breaking
rank-derived-from-index. The migration instead recreates the type in declared
order, following the precedent in `packages/db/drizzle/0017_even_thing.sql`.

**A database `CHECK` constraint on parent type.** Rejected for now — incompatible
with a gradual rollout (see Decision 3). It becomes available if F3 ever does a
one-time backfill instead, and should be revisited then.

**Keeping a fixed ladder sized for six levels.** Rejected: it moves the problem
by exactly one tier and guarantees a repeat. F3 continues to grow.

## Consequences

**Good.** Adding the next tier is a one-line array change plus a migration and
data backfill, not a project. The admin UI generates itself from the config, so
new tiers surface without per-type files. Depth bugs now fail at compile time or
are bounded at query time rather than returning wrong data.

**Costs.** Recursive CTEs are harder to read than join ladders and cannot be
expressed through the query builder at the pinned drizzle version. The enum's
array order is load-bearing in a way that is not locally obvious, which is why
the assertion and the comments exist. Exhaustive `Record<OrgType, …>` maps mean
adding a tier fails the build until every consumer is updated — intended, but it
makes the enum change a wider PR than it looks.

**Not covered by this decision.** Flattened representations — the `f3data`
warehouse views, the `pv_*` analytics materializations in `apps/analytics`, and
the slackbot's view ORM mapping — carry one column pair per tier. Flattening
cannot be depth-agnostic, because a column per level _is_ a hardcoded ladder, so
each new tier costs an explicit change in each of them. What this decision does
require of them is that the _resolution_ of a tier be an ancestor walk rather
than a fixed number of hops — the defect
[#1001](https://github.com/F3-Nation/f3-nation/issues/1001) tracks. The BigQuery
`paxVault` view definitions that PAX Vault reads today remain outside version
control in any F3 repo.

**Verification, and its blind spot.** A scan for the TypeScript form of the
banned pattern — `aliasedTable(schema.orgs, …)` repeated per level, or
`level1`/`level2`-style aliases — finds no remaining instances as of 2026-09-12.
What is left are single-hop semantic aliases (`ao_org`, `region_org`,
`homeRegion`, `parent_org`).

That scan is not sufficient on its own, and it is worth recording why. The same
ladder exists in raw SQL, where it looks nothing like the query-builder idiom:
`apps/analytics/analytics/sql/pv_events.sql` joins `p1`/`p2`/`p3` and would drop
sector off the end ([#1001](https://github.com/F3-Nation/f3-nation/issues/1001)).
It was missed because `apps/analytics` arrived (#800) after the audit behind
#855, and because a grep for the query-builder idiom cannot see it.

Checking this decision therefore means scanning **both** forms — the
query-builder idiom, and repeated self-joins in `.sql` files — and re-checking
whenever a new app or a long-lived branch merges. This is the third time the
catalogue has been found incomplete for exactly that reason.
