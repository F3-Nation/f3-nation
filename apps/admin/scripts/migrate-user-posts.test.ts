import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findAttendanceConflicts,
  findBeatdownConflicts,
  main,
  migrateUsersRow,
  parseArgs,
} from "./migrate-user-posts";

const mysqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const execute = vi.fn();
  const beginTransaction = vi.fn();
  const commit = vi.fn();
  const rollback = vi.fn();
  const release = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(async () => ({
    beginTransaction,
    query,
    execute,
    commit,
    rollback,
    release,
  }));
  const createPoolMock = vi.fn(() => ({ getConnection, end }));

  return {
    query,
    execute,
    beginTransaction,
    commit,
    rollback,
    release,
    end,
    getConnection,
    createPoolMock,
  };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mysqlMocks.createPoolMock },
  createPool: mysqlMocks.createPoolMock,
}));

const {
  query,
  execute,
  beginTransaction,
  commit,
  rollback,
  release,
  end,
  getConnection,
  createPoolMock,
} = mysqlMocks;

const originalArgv = [...process.argv];

beforeEach(() => {
  query.mockReset();
  execute.mockReset();
  beginTransaction.mockReset();
  commit.mockReset();
  rollback.mockReset();
  release.mockReset();
  end.mockReset();
  getConnection.mockClear();
  createPoolMock.mockClear();
  process.argv = [...originalArgv];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MYSQL_URL;
  process.argv = [...originalArgv];
});

describe("parseArgs", () => {
  it("exits when required arguments are missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);

    process.argv = ["node", "script.ts"];

    expect(() => parseArgs()).toThrow(/exit 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parses the current and new Slack user IDs", () => {
    process.argv = ["node", "script.ts", "old-id", "new-id"];

    expect(parseArgs()).toEqual({
      currentSlackUserId: "old-id",
      newSlackUserId: "new-id",
    });
  });
});

describe("conflict detection", () => {
  it("detects beatdown conflicts", async () => {
    const connection = {
      query: vi.fn(async () => [[{ ao_id: 1, bd_date: "2024-01-01" }], []]),
    } as never;

    const conflict = await findBeatdownConflicts(connection, "current", "new");

    expect(conflict?.table).toBe("beatdowns");
    expect(conflict?.details[0]).toContain("ao_id=1");
  });

  it("detects attendance conflicts", async () => {
    const connection = {
      query: vi.fn(async () => [
        [
          {
            ao_id: 2,
            date: "2024-02-02",
            target_user_id: "target",
            target_q_user_id: "target-q",
          },
        ],
        [],
      ]),
    } as never;

    const conflict = await findAttendanceConflicts(
      connection,
      "current",
      "new",
    );

    expect(conflict?.table).toBe("bd_attendance");
    expect(conflict?.details[0]).toContain("ao_id=2");
  });
});

describe("migrateUsersRow", () => {
  it("renames the user when only the current ID exists", async () => {
    const connection = {
      query: vi.fn(async () => [[{ user_id: "current" }], []]),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
    } as never;

    const result = await migrateUsersRow(connection, "current", "new");

    expect(result).toMatch(/Renamed users\.user_id/);
    expect(connection.execute).toHaveBeenCalledWith(
      "UPDATE users SET user_id = ? WHERE user_id = ?",
      ["new", "current"],
    );
  });

  it("leaves rows alone when both IDs exist", async () => {
    const connection = {
      query: vi.fn(async () => [
        [{ user_id: "current" }, { user_id: "new" }],
        [],
      ]),
      execute: vi.fn(async () => [{ affectedRows: 0 }]),
    } as never;

    const result = await migrateUsersRow(connection, "current", "new");

    expect(result).toMatch(/both Slack user IDs exist/i);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("assumes new user exists when only the target ID is present", async () => {
    const connection = {
      query: vi.fn(async () => [[{ user_id: "new" }], []]),
      execute: vi.fn(async () => [{ affectedRows: 0 }]),
    } as never;

    const result = await migrateUsersRow(connection, "current", "new");

    expect(result).toMatch(/already exists/);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("reports when neither user ID is found", async () => {
    const connection = {
      query: vi.fn(async () => [[], []]),
      execute: vi.fn(async () => [{ affectedRows: 0 }]),
    } as never;

    const result = await migrateUsersRow(connection, "current", "new");

    expect(result).toMatch(/No users rows found/);
  });
});

describe("main", () => {
  it("migrates data between Slack users", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";
    process.argv = ["node", "script.ts", "old-user", "new-user"];

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM beatdowns")) return [[], []];
      if (sql.includes("FROM bd_attendance")) return [[], []];
      if (sql.startsWith("SELECT user_id FROM users")) {
        return [[{ user_id: "old-user" }, { user_id: "new-user" }], []];
      }
      return [[], []];
    });
    execute.mockResolvedValue([{ affectedRows: 1 }]);

    await main();

    expect(beginTransaction).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(4);
    expect(commit).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });
});
