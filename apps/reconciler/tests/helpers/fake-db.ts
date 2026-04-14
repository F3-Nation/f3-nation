/**
 * In-memory fake for the tiny subset of ReconcilerDb that operations
 * actually exercise. We do NOT attempt to emulate drizzle-orm's full query
 * builder — instead we model:
 *
 *   - `db.select().from(table).where(whereExpr).limit(n)` → row array
 *   - `db.select().from(table).where(whereExpr).orderBy(...).limit(n)`
 *   - `db.update(table).set(values).where(whereExpr).returning()` → rows
 *   - `db.update(table).set(values).where(whereExpr)` → void
 *   - `db.insert(table).values(row)`
 *
 * The fake keeps three arrays: `regionCustomDomains`, `events`, and a
 * recorded call log. Where-expressions from drizzle's `eq()`/`and()` are
 * opaque SQLWrapper objects; since we don't care about matching them
 * structurally, the fake returns rows that were pre-seeded by key. Tests
 * stage the state directly and assert outputs.
 */

import type { ReconcilerDb } from "../../src/db/client.js";
import type {
  RegionCustomDomain,
  RegionCustomDomainEvent,
} from "@acme/redirect-platform-db";

export interface FakeDbState {
  rows: RegionCustomDomain[];
  events: RegionCustomDomainEvent[];
  /** Records every non-trivial call so tests can assert order. */
  log: string[];
}

/**
 * Matcher used by select().from().where() to decide which rows to return.
 * Tests can override this via `fake.filter = row => ...`.
 */
export interface FakeDbMatchers {
  /** Called for each select() — return the rows to hand back. */
  filter?: (row: RegionCustomDomain) => boolean;
}

export interface FakeDb {
  db: ReconcilerDb;
  state: FakeDbState;
  matchers: FakeDbMatchers;
}

export function createFakeDb(initial: Partial<FakeDbState> = {}): FakeDb {
  const state: FakeDbState = {
    rows: initial.rows ?? [],
    events: initial.events ?? [],
    log: [],
  };
  const matchers: FakeDbMatchers = {};

  function select(): { from: (table: unknown) => SelectFrom } {
    return {
      from(_table) {
        return createSelectFrom(state, matchers);
      },
    };
  }

  function update(table: unknown): UpdateChain {
    return createUpdateChain(state, table);
  }

  function insert(table: unknown): InsertChain {
    return createInsertChain(state, table);
  }

  const db = {
    select,
    update,
    insert,
  } as unknown as ReconcilerDb;

  return { db, state, matchers };
}

interface SelectFrom {
  where(expr: unknown): SelectFromWhere;
}
interface SelectFromWhere {
  limit(n: number): Promise<RegionCustomDomain[]>;
  orderBy(...exprs: unknown[]): SelectFromWhereOrderBy;
}
interface SelectFromWhereOrderBy {
  limit(n: number): Promise<RegionCustomDomain[]>;
}

function createSelectFrom(
  state: FakeDbState,
  matchers: FakeDbMatchers,
): SelectFrom {
  return {
    where(_expr) {
      const chain = {
        async limit(n: number) {
          state.log.push(`select.limit(${String(n)})`);
          const filtered = matchers.filter
            ? state.rows.filter(matchers.filter)
            : state.rows;
          return filtered.slice(0, n);
        },
        orderBy(..._exprs: unknown[]) {
          return {
            async limit(n: number) {
              state.log.push(`select.orderBy.limit(${String(n)})`);
              const filtered = matchers.filter
                ? state.rows.filter(matchers.filter)
                : state.rows;
              return filtered.slice(0, n);
            },
          };
        },
      };
      return chain;
    },
  };
}

interface UpdateChain {
  set(values: Record<string, unknown>): UpdateSet;
}
interface UpdateSet {
  where(expr: unknown): UpdateWhere;
}
interface UpdateWhere {
  returning(): Promise<RegionCustomDomain[]>;
  then<TResult1 = void, TResult2 = never>(
    onfulfilled?:
      | ((value: void) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2>;
}

function createUpdateChain(state: FakeDbState, _table: unknown): UpdateChain {
  return {
    set(values) {
      return {
        where(_expr) {
          // Apply the update to any row whose id matches the current
          // "hint" id. We use a very loose model: if `values` contains an
          // `id` lookup we match exactly; otherwise the test drives the
          // target via `state.rows[0]`.
          // For our tests we call applyUpdate() with a matcher function.
          return createUpdateWhereApply(state, values);
        },
      };
    },
  };
}

function createUpdateWhereApply(
  state: FakeDbState,
  values: Record<string, unknown>,
): UpdateWhere {
  // Heuristic: match the row whose currentStateHint matches a stored
  // value and whose id matches patch.id if present. Tests set `state.rows`
  // carefully and rely on the fact that our operations read a row, then
  // update it — so we match the first row with matching lifecycleState if
  // a newState was set (state-guarded UPDATE), otherwise all rows.
  const newState = values.lifecycleState as string | undefined;
  const matchIds = (state as FakeDbState & { _guardId?: string })._guardId;

  function apply(): RegionCustomDomain[] {
    const applied: RegionCustomDomain[] = [];
    for (let i = 0; i < state.rows.length; i++) {
      const r = state.rows[i];
      if (!r) continue;
      if (matchIds !== undefined && r.id !== matchIds) continue;
      // For state-guarded updates, tests pre-set `_expectedState` so we
      // know which row to match.
      const expected = (state as FakeDbState & { _expectedState?: string })
        ._expectedState;
      if (expected !== undefined && r.lifecycleState !== expected) continue;
      const next: RegionCustomDomain = {
        ...r,
        ...values,
      } as RegionCustomDomain;
      state.rows[i] = next;
      applied.push(next);
      // Only one row per call — keeps the "RETURNING *" single-row semantics.
      break;
    }
    state.log.push(`update.set{newState=${String(newState ?? "<same>")}}`);
    return applied;
  }

  const chain: UpdateWhere = {
    async returning() {
      return apply();
    },
    then(onfulfilled, onrejected) {
      try {
        apply();
        return Promise.resolve().then(onfulfilled, onrejected);
      } catch (err) {
        return Promise.reject(err).catch(
          onrejected ?? (() => undefined),
        ) as Promise<never>;
      }
    },
  };
  return chain;
}

interface InsertChain {
  values(row: Record<string, unknown>): Promise<void>;
}
function createInsertChain(state: FakeDbState, _table: unknown): InsertChain {
  return {
    async values(row) {
      // Only used by appendDomainEvent. Best-effort cast.
      state.events.push(row as unknown as RegionCustomDomainEvent);
      state.log.push("insert.values");
    },
  };
}

// ---------------------------------------------------------------------------
// State-guard helpers
// ---------------------------------------------------------------------------

/**
 * Set the implicit state-guard filters the fake uses to match UPDATE
 * statements. Call this before each operation under test so the fake
 * mimics the `WHERE id = $id AND lifecycle_state = $expected` guard.
 */
export function setStateGuard(
  fake: FakeDb,
  guard: { id?: string; expectedState?: string },
): void {
  (
    fake.state as FakeDbState & {
      _guardId?: string;
      _expectedState?: string;
    }
  )._guardId = guard.id;
  (
    fake.state as FakeDbState & {
      _guardId?: string;
      _expectedState?: string;
    }
  )._expectedState = guard.expectedState;
}

// ---------------------------------------------------------------------------
// Sample row factory
// ---------------------------------------------------------------------------

export function makeRow(
  overrides: Partial<RegionCustomDomain> = {},
): RegionCustomDomain {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: 42,
    regionSlug: "muletown",
    regionId: "35838",
    regionName: "Muletown",
    hostname: "f3marshall.com",
    hostnameRole: "apex",
    gcpDnsAuthorizationId: null,
    gcpCertificateId: null,
    gcpCertMapEntryId: null,
    dnsChallengeRecordName: null,
    dnsChallengeRecordValue: null,
    lifecycleState: "awaiting_dns_challenge",
    probeConsecutiveSuccesses: 0,
    probeLastAttemptedAt: null,
    probeLastResultDetail: null,
    probeRegionUsCentral1LastSuccess: null,
    probeRegionEuropeWest1LastSuccess: null,
    lastReconciledAt: null,
    reconcilerError: null,
    createdBy: 1,
    createdAt: new Date("2026-04-14T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-04-14T10:00:00Z").toISOString(),
    tombstonedAt: null,
    releasedAt: null,
    ...overrides,
  };
}
