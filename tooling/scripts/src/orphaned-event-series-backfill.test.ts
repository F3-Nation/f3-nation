/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import { describe, expect, it, vi } from "vitest";
import type { FileHandle } from "node:fs/promises";
import type { AppDb } from "@acme/db/client";
import type { SeriesData } from "../../../packages/api/src/lib/cascade-service.js";
import {
  applyOne,
  candidatePredicate,
  failureCategory,
  getCandidateIds,
  journalCreated,
  main,
  RunDateChanged,
  reserveArtifact,
  runBackfill,
  validateInvocation,
} from "./orphaned-event-series-backfill.js";
import type { Counts } from "./orphaned-event-series-backfill.js";

const database = {} as AppDb;
const artifact = {} as never;
const series = (id: number) => ({ id }) as SeriesData;

function fakeHandle(
  overrides: { write?: (value: string) => Promise<unknown> } = {},
) {
  const result = {
    writes: [] as string[],
    sync: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    write:
      overrides.write ??
      (async (value: string) => {
        result.writes.push(value);
      }),
  };
  return result;
}

function counts() {
  return {
    eligible: 0,
    wouldCreate: 0,
    created: 0,
    skipped: 0,
    failures: 0,
    skipReasons: { noInstances: 0, becameIneligible: 0 },
    failureCategories: {},
  };
}

function applyDatabase(
  eligible: unknown[],
  commit: () => void = () => undefined,
) {
  let query = 0;
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        for: vi.fn(async () => [{ id: 7 }]),
        then: (resolve: (value: unknown[]) => unknown) => {
          query++;
          return Promise.resolve(
            resolve(query === 1 ? eligible : [{ eventTypeId: 9 }]),
          );
        },
      };
      return chain;
    }),
    transaction: vi.fn(
      async (callback: (tx: unknown) => Promise<void>, config: unknown) => {
        await callback(db);
        expect(config).toEqual({
          isolationLevel: "serializable",
          accessMode: "read write",
        });
        commit();
      },
    ),
  };
  return db as never;
}

describe("orphaned event-series backfill orchestration", () => {
  it("validates apply confirmation and output requirements", () => {
    expect(validateInvocation({ apply: true, confirm: false })).toContain(
      "confirm-event-writes-quiesced",
    );
    expect(validateInvocation({ apply: true, confirm: true })).toContain(
      "output",
    );
    expect(
      validateInvocation({ apply: false, confirm: false }),
    ).toBeUndefined();
  });

  it("reports malformed local database configuration as a safe dry-run failure category", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      process.argv = ["node", "orphaned-event-series-backfill.ts"];
      process.exitCode = undefined;
      await main({
        createClient: () => {
          throw Object.assign(new Error("invalid database URL"), {
            code: "ERR_INVALID_URL",
          });
        },
      });
      expect(failureCategory({ code: "ERR_INVALID_URL" })).toBe("config_error");
      expect(process.exitCode).toBe(1);
      const summary = JSON.parse(String(output.mock.calls.at(-1)?.[0])) as {
        failureCategories: Record<string, number>;
      };
      expect(summary.failureCategories).toEqual({ config_error: 1 });
    } finally {
      output.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it("rejects outside and unignored artifact paths before opening files", async () => {
    const open = vi.fn();
    const deps = {
      execFile: vi.fn(async (_command: string, args: string[]) =>
        args[0] === "rev-parse"
          ? { stdout: "/repo\n" }
          : Promise.reject(new Error("not ignored")),
      ),
      realpath: vi.fn(async (path: string) => path),
      open: open as unknown as (
        path: string,
        flags: string,
        mode?: number,
      ) => Promise<FileHandle>,
      chmod: vi.fn(),
    };
    await expect(
      reserveArtifact("output.json", "2026-08-29", deps),
    ).rejects.toThrow(".local");
    await expect(
      reserveArtifact(".local/output.json", "2026-08-29", deps),
    ).rejects.toThrow("gitignored");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens artifacts mode 0600 and fsyncs both file and parent directory", async () => {
    const file = fakeHandle();
    const directory = fakeHandle();
    const open = vi.fn(
      async (_path: string, mode: string, permissions?: number) => {
        if (mode === "wx") {
          expect(permissions).toBe(0o600);
          return file;
        }
        return directory;
      },
    );
    const artifact = await reserveArtifact(".local/output.json", "2026-08-29", {
      execFile: vi.fn(async (_command: string, args: string[]) =>
        args[0] === "rev-parse" ? { stdout: "/repo\n" } : { stdout: "" },
      ),
      realpath: vi.fn(async (path: string) => path),
      open: open as unknown as (
        path: string,
        flags: string,
        mode?: number,
      ) => Promise<FileHandle>,
      chmod: vi.fn(),
    });
    expect(artifact).toBe(file);
    expect(file.sync).toHaveBeenCalledOnce();
    expect(directory.sync).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes a reserved artifact when initialization fails", async () => {
    const file = fakeHandle({
      write: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await expect(
      reserveArtifact(".local/output.json", "2026-08-29", {
        execFile: vi.fn(async (_command: string, args: string[]) =>
          args[0] === "rev-parse" ? { stdout: "/repo\n" } : { stdout: "" },
        ),
        realpath: vi.fn(async (path: string) => path),
        open: vi.fn(async () => file as unknown as FileHandle),
        chmod: vi.fn(),
      }),
    ).rejects.toThrow("disk full");
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("builds a bounded keyset query with the fixed-date predicate", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => where()),
    };
    const db = { select: vi.fn(() => chain) } as never;
    await getCandidateIds(db, "2026-08-29", 41);
    expect(chain.limit).toHaveBeenCalledWith(50);
    const seen = new WeakSet<object>();
    const sqlText = JSON.stringify(
      candidatePredicate("2026-08-29"),
      (_key, value: unknown) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
    );
    expect(sqlText).toContain("2026-08-29");
    expect(chain.where).toHaveBeenCalledOnce();
  });

  it("locks, rechecks, fetches current types, journals before commit, and uses serializable writes", async () => {
    const file = fakeHandle();
    const calls: string[] = [];
    let selectCount = 0;
    const makeChain = () => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        for: vi.fn(async () => {
          calls.push("lock");
          return [{ id: 7, name: "x" }];
        }),
        then: (resolve: (value: unknown[]) => unknown) => {
          selectCount++;
          calls.push(selectCount === 1 ? "recheck" : "types");
          return Promise.resolve(
            resolve(selectCount === 1 ? [{ id: 7 }] : [{ eventTypeId: 9 }]),
          );
        },
      };
      return chain;
    };
    const db = {
      select: vi.fn(() => makeChain()),
      transaction: vi.fn(
        async (callback: (tx: unknown) => Promise<void>, config: unknown) => {
          expect(config).toEqual({
            isolationLevel: "serializable",
            accessMode: "read write",
          });
          await callback(db);
          calls.push("commit");
        },
      ),
    } as never;
    const result = counts();
    const createInstances = vi.fn(async (_db, _series, _years, _date) => {
      calls.push("create");
      return [101];
    });
    await applyOne(db, 7, "2026-08-29", result, file as unknown as FileHandle, {
      databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
      createInstances,
      journalCreated: vi.fn(async () => {
        calls.push("journal");
        await file.sync();
      }),
    });
    expect(calls).toEqual([
      "lock",
      "recheck",
      "types",
      "create",
      "journal",
      "commit",
    ]);
    const createdSeries = createInstances.mock.calls[0]?.[1] as SeriesData;
    expect(createdSeries.eventTypeIds).toEqual([9]);
  });

  it("journals IDs with the real helper and fsyncs the artifact", async () => {
    const file = fakeHandle();
    await journalCreated(file as unknown as FileHandle, [101, 102]);
    expect(file.writes).toEqual(['{"createdInstanceIds":[101,102]}\n']);
    expect(file.sync).toHaveBeenCalledOnce();
  });

  it("rolls back when the real journal write/fsync fails", async () => {
    const file = fakeHandle({
      write: async () => {
        throw new Error("journal failed");
      },
    });
    let committed = false;
    const db = applyDatabase([{ id: 7 }], () => {
      committed = true;
    });
    const result = counts();
    await applyOne(db, 7, "2026-08-29", result, file as unknown as FileHandle, {
      databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
      createInstances: vi.fn(async () => [101]),
      journalCreated,
    });
    expect(committed).toBe(false);
    expect(result.created).toBe(0);
  });

  it("retries the complete transaction after one serialization failure", async () => {
    const file = fakeHandle();
    let attempts = 0;
    let created = 0;
    const db = applyDatabase([{ id: 7 }]);
    const transaction = vi.fn(
      async (callback: (tx: unknown) => Promise<void>) => {
        attempts++;
        if (attempts === 1) {
          throw Object.assign(new Error("serialization"), { code: "40001" });
        }
        await callback(db);
      },
    );
    (db as { transaction: typeof transaction }).transaction = transaction;
    const result = counts();
    await applyOne(db, 7, "2026-08-29", result, file as unknown as FileHandle, {
      databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
      createInstances: vi.fn(async () => {
        created++;
        return [101];
      }),
      journalCreated: vi.fn(async () => undefined),
    });
    expect(attempts).toBe(2);
    expect(created).toBe(1);
    expect(result.created).toBe(1);
  });

  it("retries when serialization fails after the callback, without double-counting", async () => {
    let query = 0;
    let callbacks = 0;
    let committed = 0;
    let created = 0;
    const db = {
      select: vi.fn(() => {
        const chain = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          for: vi.fn(async () => [{ id: 7 }]),
          then: (resolve: (value: unknown[]) => unknown) => {
            query++;
            return Promise.resolve(
              resolve(query === 1 ? [{ id: 7 }] : [{ eventTypeId: 9 }]),
            );
          },
        };
        return chain;
      }),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        callbacks++;
        query = 0;
        await callback(db);
        if (callbacks === 1) {
          throw Object.assign(new Error("commit serialization"), {
            code: "40001",
          });
        }
        committed++;
      }),
    } as never;
    const journaled: number[] = [];
    const result = counts();
    await applyOne(
      db,
      7,
      "2026-08-29",
      result,
      fakeHandle() as unknown as FileHandle,
      {
        databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
        createInstances: vi.fn(async () => {
          created++;
          return [100 + created];
        }),
        journalCreated: vi.fn(async (_file, ids: number[]) => {
          journaled.push(...ids);
        }),
      },
    );
    expect(callbacks).toBe(2);
    expect(created).toBe(2);
    expect(journaled).toEqual([101, 102]);
    expect(committed).toBe(1);
    expect(result.created).toBe(1);
  });

  it("closes the client and artifact and reports main success/failure outcomes", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      for (const shouldFail of [false, true]) {
        process.argv = [
          "node",
          "orphaned-event-series-backfill.ts",
          "--apply",
          "--confirm-event-writes-quiesced",
          "--output=.local/run",
        ];
        process.exitCode = undefined;
        const artifactHandle = fakeHandle();
        const close = vi.fn(async () => undefined);
        const client = { db: {} as AppDb, close };
        await main({
          createClient: () => client,
          databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
          reserveArtifact: vi.fn(
            async () => artifactHandle as unknown as FileHandle,
          ),
          runBackfill: vi.fn(async (_db, _date, _apply, result: Counts) => {
            if (shouldFail) result.failures = 1;
          }),
        });
        expect(close).toHaveBeenCalledOnce();
        expect(artifactHandle.close).toHaveBeenCalledOnce();
        if (shouldFail) expect(process.exitCode).toBe(1);
        else expect(process.exitCode).toBeUndefined();
      }
    } finally {
      output.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it("closes artifact and database client when the main run fails unexpectedly", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const artifactHandle = fakeHandle();
    const close = vi.fn(async () => undefined);
    try {
      process.argv = [
        "node",
        "orphaned-event-series-backfill.ts",
        "--apply",
        "--confirm-event-writes-quiesced",
        "--output=.local/run",
      ];
      process.exitCode = undefined;
      await main({
        createClient: () => ({ db: {} as AppDb, close }),
        databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
        reserveArtifact: vi.fn(
          async () => artifactHandle as unknown as FileHandle,
        ),
        runBackfill: vi.fn(async () => {
          throw new Error("unexpected run failure");
        }),
      });
      expect(close).toHaveBeenCalledOnce();
      expect(artifactHandle.close).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    } finally {
      output.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it("rolls back after creation when the post-create UTC date changes", async () => {
    const calls: string[] = [];
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        const chain = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          for: vi.fn(async () => [{ id: 7 }]),
          then: (resolve: (value: unknown[]) => unknown) => {
            selectCount++;
            return Promise.resolve(
              resolve(selectCount === 1 ? [{ id: 7 }] : [{ eventTypeId: 9 }]),
            );
          },
        };
        return chain;
      }),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        try {
          await callback(db);
          calls.push("commit");
        } catch (error) {
          calls.push("rollback");
          throw error;
        }
      }),
    } as never;
    const date = vi
      .fn()
      .mockResolvedValueOnce("2026-08-29")
      .mockResolvedValueOnce("2026-08-30");
    const journal = vi.fn();
    await expect(
      applyOne(
        db,
        7,
        "2026-08-29",
        counts(),
        fakeHandle() as unknown as FileHandle,
        {
          databaseUtcDate: date,
          createInstances: vi.fn(async () => [101]),
          journalCreated: journal,
        },
      ),
    ).rejects.toBeInstanceOf(RunDateChanged);
    expect(date).toHaveBeenCalledTimes(2);
    expect(journal).not.toHaveBeenCalled();
    expect(calls).toEqual(["rollback"]);
  });

  it("skips after the post-lock recheck and classifies zero-created results", async () => {
    const makeDb = (eligible: unknown[]) => {
      let selectCount = 0;
      const db = {
        select: vi.fn(() => {
          const chain = {
            from: vi.fn(() => chain),
            where: vi.fn(() => chain),
            for: vi.fn(async () => [{ id: 7 }]),
            then: (resolve: (value: unknown[]) => unknown) => {
              selectCount++;
              return Promise.resolve(
                resolve(selectCount === 1 ? eligible : [{ eventTypeId: 9 }]),
              );
            },
          };
          return chain;
        }),
        transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
          callback(db),
        ),
      } as never;
      return db;
    };
    const skipped = counts();
    const create = vi.fn();
    await applyOne(
      makeDb([]),
      7,
      "2026-08-29",
      skipped,
      fakeHandle() as unknown as FileHandle,
      {
        databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
        createInstances: create,
      },
    );
    expect(skipped.skipReasons.becameIneligible).toBe(1);
    expect(create).not.toHaveBeenCalled();

    const empty = counts();
    await applyOne(
      makeDb([{ id: 7 }]),
      7,
      "2026-08-29",
      empty,
      fakeHandle() as unknown as FileHandle,
      {
        databaseUtcDate: vi.fn().mockResolvedValue("2026-08-29"),
        createInstances: vi.fn(async () => []),
      },
    );
    expect(empty.skipReasons.noInstances).toBe(1);
    expect(empty.created).toBe(0);
  });

  it("retries serialization and deadlock failures, then classifies exhaustion", async () => {
    const result = counts();
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "40001" })
      .mockRejectedValueOnce({ code: "40P01" })
      .mockRejectedValueOnce({ code: "40001" })
      .mockRejectedValueOnce({ code: "40P01" })
      .mockRejectedValueOnce({ code: "40001" });
    await applyOne(
      { transaction } as never,
      7,
      "2026-08-29",
      result,
      fakeHandle() as unknown as FileHandle,
      { databaseUtcDate: vi.fn() },
    );
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      failures: 1,
      failureCategories: { serialization_exhausted: 1 },
    });
  });

  it("aborts before locking when the pre-write UTC date changes", async () => {
    const db = {} as { transaction: ReturnType<typeof vi.fn> };
    const transaction = vi.fn(
      async (callback: (tx: unknown) => Promise<void>) => callback(db),
    );
    db.transaction = transaction;
    const journal = vi.fn();
    const result = counts();
    await expect(
      applyOne(
        db as never,
        7,
        "2026-08-29",
        result,
        fakeHandle() as unknown as FileHandle,
        {
          databaseUtcDate: vi.fn().mockResolvedValue("2026-08-30"),
          journalCreated: journal,
        },
      ),
    ).rejects.toBeInstanceOf(RunDateChanged);
    expect(transaction).toHaveBeenCalledOnce();
    expect(journal).not.toHaveBeenCalled();
  });

  it("dry-run pages by the returned cursor and performs no apply work", async () => {
    const pages = [[3, 7], [12], []];
    const cursors: number[] = [];
    const apply = vi.fn();
    await runBackfill(database, "2026-08-29", false, counts(), undefined, {
      getCandidateIds: vi.fn((_db: AppDb, _date: string, cursor: number) => {
        cursors.push(cursor);
        return Promise.resolve(pages.shift()!);
      }),
      getSeriesBatch: vi.fn((_db: AppDb, ids: number[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, series(id)]))),
      ),
      prepareEventInstanceRecords: vi.fn((item: SeriesData) =>
        item.id === 7 ? [] : [{} as never],
      ),
      applyOne: apply,
    });
    expect(cursors).toEqual([0, 7, 12]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("continues after a per-series failure and reports a safe category", async () => {
    const result = counts();
    const pages = [[10, 11], []];
    const processed: number[] = [];
    await runBackfill(database, "2026-08-29", true, result, artifact, {
      getCandidateIds: vi.fn(() => Promise.resolve(pages.shift()!)),
      applyOne: vi.fn((_db: AppDb, id: number) => {
        processed.push(id);
        return id === 10
          ? Promise.reject(new Error("private database detail"))
          : Promise.resolve();
      }),
    });
    expect(processed).toEqual([10, 11]);
    expect(result).toMatchObject({
      failures: 1,
      failureCategories: { run_failed: 1 },
    });
  });

  it("does not continue past a UTC rollover", async () => {
    const result = counts();
    const apply = vi.fn(() => Promise.reject(new RunDateChanged()));
    await expect(
      runBackfill(database, "2026-08-29", true, result, artifact, {
        getCandidateIds: vi.fn(() => Promise.resolve([1])),
        applyOne: apply,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(apply).toHaveBeenCalledOnce();
  });
});
