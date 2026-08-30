import { chmod, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative } from "node:path";

import { createLogger } from "../../../packages/logger/src/index.js";
import {
  createEventInstancesForSeriesReturningIds,
  prepareEventInstanceRecords,
} from "../../../packages/api/src/lib/cascade-service.js";
import type { SeriesData } from "../../../packages/api/src/lib/cascade-service.js";
import { schema, sql } from "@acme/db";
import { createDbClient } from "../../../packages/db/src/utils/functions.js";
import type { AppDb } from "@acme/db/client";
import { and, eq, inArray } from "drizzle-orm";

const execFile = promisify(execFileCallback);
export const BATCH_SIZE = 50;
export const MAX_SERIALIZATION_RETRIES = 3;
const logger = createLogger("orphaned-event-series-backfill");

export interface Counts {
  eligible: number;
  wouldCreate: number;
  created: number;
  skipped: number;
  failures: number;
  skipReasons: { noInstances: number; becameIneligible: number };
  failureCategories: Record<string, number>;
}

interface ArtifactMetadata {
  mode: "apply";
  runUtcDate: string;
  format: "orphaned-event-series-backfill/v1";
}

export class RunDateChanged extends Error {}

export const candidatePredicate = (runUtcDate: string) => sql`
  ${schema.events.isActive} = true
  AND (${schema.events.endDate} IS NULL OR ${schema.events.endDate} > ${runUtcDate}::date)
  AND NOT EXISTS (
    SELECT 1 FROM ${schema.eventInstances} AS i
    WHERE i.series_id = ${schema.events.id}
      AND i.is_active = true
      AND i.start_date > ${runUtcDate}::date
  )
`;

export function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (code === "40001" || code === "40P01") return true;
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

export function failureCategory(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "ERR_INVALID_URL") return "config_error";
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  )
    return "connection_error";
  if (
    typeof error === "object" &&
    error !== null &&
    (error.constructor?.name === "DrizzleQueryError" || "query" in error)
  )
    return "query_error";
  return "run_failed";
}

export async function databaseUtcDate(database: AppDb): Promise<string> {
  const result = await database.execute<{ today: string }>(
    sql`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS today`,
  );
  const today = result[0]?.today;
  if (!today) throw new Error("Database did not return a UTC date");
  return today;
}

function seriesSelect(database: AppDb) {
  return database
    .select({
      id: schema.events.id,
      orgId: schema.events.orgId,
      locationId: schema.events.locationId,
      name: schema.events.name,
      description: schema.events.description,
      startDate: schema.events.startDate,
      endDate: schema.events.endDate,
      startTime: schema.events.startTime,
      endTime: schema.events.endTime,
      dayOfWeek: schema.events.dayOfWeek,
      recurrencePattern: schema.events.recurrencePattern,
      recurrenceInterval: schema.events.recurrenceInterval,
      indexWithinInterval: schema.events.indexWithinInterval,
      isActive: schema.events.isActive,
      isPrivate: schema.events.isPrivate,
      highlight: schema.events.highlight,
      meta: schema.events.meta,
    })
    .from(schema.events);
}

export async function getCandidateIds(
  database: AppDb,
  runUtcDate: string,
  afterId: number,
): Promise<number[]> {
  const rows = await database
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        sql`${schema.events.id} > ${afterId}`,
        candidatePredicate(runUtcDate),
      ),
    )
    .orderBy(schema.events.id)
    .limit(BATCH_SIZE);
  return rows.map((row) => row.id);
}

async function getSeriesBatch(
  database: AppDb,
  ids: number[],
): Promise<Map<number, SeriesData>> {
  const rows = await seriesSelect(database).where(
    inArray(schema.events.id, ids),
  );
  const types = await database
    .select({
      eventId: schema.eventsXEventTypes.eventId,
      eventTypeId: schema.eventsXEventTypes.eventTypeId,
    })
    .from(schema.eventsXEventTypes)
    .where(inArray(schema.eventsXEventTypes.eventId, ids));
  const typeIds = new Map<number, number[]>();
  for (const type of types)
    typeIds.set(type.eventId, [
      ...(typeIds.get(type.eventId) ?? []),
      type.eventTypeId,
    ]);
  return new Map(
    rows.map((row) => [
      row.id,
      { ...row, eventTypeIds: typeIds.get(row.id) ?? [] },
    ]),
  );
}

export interface BackfillDependencies {
  getCandidateIds: typeof getCandidateIds;
  getSeriesBatch: typeof getSeriesBatch;
  applyOne: typeof applyOne;
  prepareEventInstanceRecords: typeof prepareEventInstanceRecords;
}

/** The bounded orchestration loop, separated so its safety outcomes can be tested without a live database. */
export async function runBackfill(
  database: AppDb,
  runUtcDate: string,
  apply: boolean,
  counts: Counts,
  artifact: FileHandle | undefined,
  dependencies: Partial<BackfillDependencies> = {},
): Promise<void> {
  const getCandidates = dependencies.getCandidateIds ?? getCandidateIds;
  const getSeries = dependencies.getSeriesBatch ?? getSeriesBatch;
  const processOne = dependencies.applyOne ?? applyOne;
  const prepare =
    dependencies.prepareEventInstanceRecords ?? prepareEventInstanceRecords;
  let afterId = 0;
  for (;;) {
    const ids = await getCandidates(database, runUtcDate, afterId);
    if (ids.length === 0) return;
    afterId = ids[ids.length - 1]!;
    counts.eligible += ids.length;
    if (!apply) {
      const series = await getSeries(database, ids);
      for (const item of series.values()) {
        const count = prepare(item, 4, runUtcDate).length;
        if (count === 0) {
          counts.skipped++;
          counts.skipReasons.noInstances++;
        } else counts.wouldCreate += count;
      }
    } else {
      if (!artifact) throw new Error("apply requires an artifact");
      for (const id of ids) {
        try {
          await processOne(database, id, runUtcDate, counts, artifact);
        } catch (error) {
          if (error instanceof RunDateChanged) throw error;
          countFailure(counts, "run_failed");
        }
      }
    }
  }
}

type ArtifactOpen = (
  path: string,
  flags: string,
  mode?: number,
) => Promise<FileHandle>;
type ArtifactRealpath = (path: string) => Promise<string>;
type ArtifactChmod = (path: string, mode: number) => Promise<void>;
type ArtifactExecFile = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;

interface ArtifactDependencies {
  realpath: ArtifactRealpath;
  open: ArtifactOpen;
  chmod: ArtifactChmod;
  execFile: ArtifactExecFile;
}

export async function reserveArtifact(
  path: string,
  runUtcDate: string,
  dependencies: Partial<ArtifactDependencies> = {},
): Promise<FileHandle> {
  const fs = { realpath, open, chmod, execFile, ...dependencies };
  const { stdout } = await fs.execFile("git", ["rev-parse", "--show-toplevel"]);
  const root = await fs.realpath(stdout.trim());
  const local = await fs.realpath(resolve(root, ".local"));
  const target = resolve(root, path);
  const parent = await fs.realpath(resolve(target, ".."));
  const targetRelative = relative(local, target);
  const parentRelative = relative(local, parent);
  if (
    !targetRelative ||
    targetRelative.startsWith("..") ||
    targetRelative.includes("/..") ||
    parentRelative.startsWith("..") ||
    parentRelative.includes("/..")
  ) {
    throw new Error("--output must be beneath the existing .local directory");
  }
  try {
    await fs.execFile("git", ["check-ignore", "--quiet", "--", target]);
  } catch {
    throw new Error("--output must be gitignored");
  }
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await fs.chmod(target, 0o600);
    await handle.write(
      `${JSON.stringify({ mode: "apply", runUtcDate, format: "orphaned-event-series-backfill/v1" } satisfies ArtifactMetadata)}\n`,
    );
    await handle.sync();
    await syncDirectory(parent, fs.open);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function syncDirectory(
  path: string,
  openDirectory: ArtifactOpen = open,
): Promise<void> {
  let directory: FileHandle | undefined;
  try {
    directory = await openDirectory(path, "r");
    await directory.sync();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // Directory fsync is not supported by some repository platforms/filesystems.
    if (
      code !== "EINVAL" &&
      code !== "ENOTSUP" &&
      code !== "EISDIR" &&
      code !== "EPERM"
    ) {
      throw new Error("could not durably persist backfill artifact", {
        cause: error,
      });
    }
  } finally {
    if (directory) await directory.close();
  }
}

export async function journalCreated(
  handle: FileHandle,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  await handle.write(`${JSON.stringify({ createdInstanceIds: ids })}\n`);
  await handle.sync();
}

function countFailure(counts: Counts, category: string): void {
  counts.failures++;
  counts.failureCategories[category] =
    (counts.failureCategories[category] ?? 0) + 1;
}

interface ApplyDependencies {
  databaseUtcDate: typeof databaseUtcDate;
  createInstances: typeof createEventInstancesForSeriesReturningIds;
  journalCreated: typeof journalCreated;
}

export async function applyOne(
  database: AppDb,
  id: number,
  runUtcDate: string,
  counts: Counts,
  artifact: FileHandle,
  dependencies: Partial<ApplyDependencies> = {},
): Promise<void> {
  const deps = {
    databaseUtcDate,
    createInstances: createEventInstancesForSeriesReturningIds,
    journalCreated,
    ...dependencies,
  };
  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt++) {
    try {
      let didCreate = false;
      let wasEligible = false;
      let createdCount = 0;
      await database.transaction(
        async (transaction) => {
          const currentDb = transaction as unknown as AppDb;
          if ((await deps.databaseUtcDate(currentDb)) !== runUtcDate)
            throw new RunDateChanged();
          const [lockedEvent] = await seriesSelect(currentDb)
            .where(eq(schema.events.id, id))
            .for("update");
          if (!lockedEvent) return;
          const eligible = await currentDb
            .select({ id: schema.events.id })
            .from(schema.events)
            .where(
              and(eq(schema.events.id, id), candidatePredicate(runUtcDate)),
            );
          if (eligible.length === 0) return;
          wasEligible = true;
          const types = await currentDb
            .select({ eventTypeId: schema.eventsXEventTypes.eventTypeId })
            .from(schema.eventsXEventTypes)
            .where(eq(schema.eventsXEventTypes.eventId, id));
          const ids = await deps.createInstances(
            currentDb,
            {
              ...lockedEvent,
              eventTypeIds: types.map((type) => type.eventTypeId),
            },
            4,
            runUtcDate,
          );
          if ((await deps.databaseUtcDate(currentDb)) !== runUtcDate)
            throw new RunDateChanged();
          await deps.journalCreated(artifact, ids);
          didCreate = ids.length > 0;
          createdCount = ids.length;
        },
        { isolationLevel: "serializable", accessMode: "read write" },
      );
      counts.created += createdCount;
      if (!didCreate) {
        counts.skipped++;
        counts.skipReasons[wasEligible ? "noInstances" : "becameIneligible"]++;
      }
      return;
    } catch (error) {
      if (error instanceof RunDateChanged) throw error;
      if (!isRetryableTransactionError(error)) {
        countFailure(counts, "transaction");
        return;
      }
    }
  }
  countFailure(counts, "serialization_exhausted");
}

function parseArgs() {
  const apply = process.argv.includes("--apply");
  const confirm = process.argv.includes("--confirm-event-writes-quiesced");
  const output = process.argv
    .find((argument) => argument.startsWith("--output="))
    ?.slice(9);
  return {
    apply,
    confirm,
    output,
    help: process.argv.includes("--help") || process.argv.includes("-h"),
  };
}

export function validateInvocation(args: {
  apply: boolean;
  confirm: boolean;
  output?: string;
}): string | undefined {
  if (args.apply !== args.confirm || (args.apply && !args.output)) {
    return "Apply requires --confirm-event-writes-quiesced and --output=<existing gitignored .local file>.";
  }
  return undefined;
}

interface MainDependencies {
  createClient: typeof createDbClient;
  reserveArtifact: typeof reserveArtifact;
  databaseUtcDate: typeof databaseUtcDate;
  runBackfill: typeof runBackfill;
}

export async function main(
  dependencies: Partial<MainDependencies> = {},
): Promise<void> {
  const deps = {
    createClient: createDbClient,
    reserveArtifact,
    databaseUtcDate,
    runBackfill,
    ...dependencies,
  };
  const { apply, confirm, output, help } = parseArgs();
  if (help) {
    process.stdout.write(
      "Usage: pnpm orphaned-event-series-backfill [--apply --confirm-event-writes-quiesced --output=.local/file]\nDefault is read-only dry-run. Apply requires an existing gitignored .local path and a fully quiescent maintenance window.\n",
    );
    return;
  }
  const argumentError = validateInvocation({ apply, confirm, output });
  if (argumentError) {
    process.stdout.write(`${argumentError}\n`);
    process.exitCode = 1;
    return;
  }
  let artifact: FileHandle | undefined;
  let client: ReturnType<typeof createDbClient> | undefined;
  const counts: Counts = {
    eligible: 0,
    wouldCreate: 0,
    created: 0,
    skipped: 0,
    failures: 0,
    skipReasons: { noInstances: 0, becameIneligible: 0 },
    failureCategories: {},
  };
  try {
    const connectedClient = deps.createClient();
    client = connectedClient;
    const database = connectedClient.db;
    const runUtcDate = await deps.databaseUtcDate(database);
    if (apply) artifact = await deps.reserveArtifact(output!, runUtcDate);
    await deps.runBackfill(database, runUtcDate, apply, counts, artifact);
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "dry-run", runUtcDate, ...counts })}\n`,
    );
    if (counts.failures > 0) process.exitCode = 1;
    logger.logInfo("backfill.orphaned_event_series.completed", {
      mode: apply ? "apply" : "dry_run",
      runUtcDate,
      ...counts,
    });
  } catch (error) {
    const category =
      error instanceof RunDateChanged
        ? "utc_date_changed"
        : failureCategory(error);
    countFailure(counts, category);
    logger.logError("backfill.orphaned_event_series.failed", {
      mode: apply ? "apply" : "dry_run",
      reason: category,
    });
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counts })}\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      if (artifact) await artifact.close();
    } finally {
      if (client) await client.close();
    }
  }
}

if (process.argv[1]?.endsWith("orphaned-event-series-backfill.ts")) void main();
