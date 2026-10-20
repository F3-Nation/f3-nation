/**
 * The staging writes around the refresh's load, kept apart from
 * staging-refresh.ts (which runs on import) so the verify harness can
 * exercise them against a throwaway database.
 */
import type postgres from "postgres";

import { quoteTable } from "./staging-refresh.checks";

type Sql = postgres.Sql;

/** Refused before staging was written: nothing to roll back. */
export class Refusal extends Error {}

export interface ForeignKey {
  table: string; // quoted "schema"."table"
  name: string; // quoted
  def: string; // pg_get_constraintdef, without any trailing NOT VALID
  validated: boolean;
}

export async function dropFksAndTruncate(
  sql: Sql,
  fks: ForeignKey[],
  tables: string[],
): Promise<void> {
  await sql.begin(async (tx) => {
    // Fail fast rather than queue behind an app's long transaction; nothing
    // has changed if this times out.
    await tx`SET LOCAL lock_timeout = '60s'`;
    for (const fk of fks) {
      await tx.unsafe(
        `ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.name}`,
      );
    }
    // The loads that follow pass LOAD_WITHOUT_TRIGGERS. Refuse here, before
    // the truncate, so nothing has changed if one of its limits is hit:
    // DISABLE TRIGGER needs ownership of every loaded table, only a superuser
    // may disable system triggers, and the closing ENABLE TRIGGER ALL would
    // turn on a trigger someone had disabled (or set to REPLICA / ALWAYS).
    const notOwned = await tx<{ t: string }[]>`
      SELECT n.nspname || '.' || c.relname AS t FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname || '.' || c.relname = ANY(${tables})
        AND NOT pg_has_role(current_user, c.relowner, 'USAGE')
      ORDER BY 1`;
    if (notOwned.length > 0) {
      throw new Refusal(
        `the job's login doesn't own ${notOwned.map((r) => r.t).join(", ")}, so the load can't disable their triggers. ` +
          `Re-run tooling/scripts/staging-refresh/setup.sh (staging-login.sql grants the owner roles), then run again.`,
      );
    }
    const blockers = await tx<
      {
        t: string;
        trigger: string;
        system: boolean;
        constraint: string | null;
        contype: string | null;
      }[]
    >`
      SELECT n.nspname || '.' || c.relname AS t, tg.tgname AS trigger,
        tg.tgisinternal AS system, co.conname AS constraint,
        co.contype::text AS contype
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_constraint co ON co.oid = tg.tgconstraint
      WHERE (tg.tgisinternal OR tg.tgenabled <> 'O')
        AND n.nspname || '.' || c.relname = ANY(${tables})
      ORDER BY 1, 2`;
    const system = blockers.filter((b) => b.system);
    if (system.length > 0) {
      const named = [
        ...new Set(
          system.map(
            (b) =>
              `${b.t} (constraint ${b.constraint ?? "?"}, type ${b.contype ?? "?"})`,
          ),
        ),
      ];
      throw new Refusal(
        `system triggers are left on ${named.join(", ")} after dropping the FKs. A DEFERRABLE unique/exclusion ` +
          `constraint leaves a system trigger the job can't disable; make it NOT DEFERRABLE on staging, or have ` +
          `dropFksAndTruncate drop and re-add it, then run again.`,
      );
    }
    if (blockers.length > 0) {
      throw new Refusal(
        `trigger(s) not in the default enabled state: ${blockers.map((b) => `${b.t}.${b.trigger}`).join(", ")}. ` +
          `The load re-enables every trigger, so set them back (ALTER TABLE … ENABLE TRIGGER …) or drop them, then run again.`,
      );
    }
    await tx.unsafe(`TRUNCATE TABLE ${tables.map(quoteTable).join(", ")}`);
  });
}

/**
 * pg_restore runs `ALTER TABLE … DISABLE TRIGGER ALL` around each table, inside
 * its single transaction, so the triggers are back on whether the load commits
 * or rolls back. The audit triggers would otherwise write a public_history row
 * per loaded row, which took a full load past the job's 3h timeout
 * (2026-10-20). Only used right after dropFksAndTruncate, which refuses if a
 * system trigger is left or a trigger isn't in the default enabled state.
 */
export const LOAD_WITHOUT_TRIGGERS = "--disable-triggers";

/**
 * Session options for those loads. Not lock_timeout: every pg_restore archive
 * starts with `SET lock_timeout = 0`, which overrides PGOPTIONS. So an app's
 * write to a loaded table blocks until the load commits (DISABLE TRIGGER holds
 * a SHARE ROW EXCLUSIVE lock), and a lock wait shows up as a slow step 9.
 */
export const LOAD_PGOPTIONS = "-c app.disable_ao_count_trigger=true";
