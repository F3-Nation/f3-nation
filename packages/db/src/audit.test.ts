import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { AppDb } from "./client";
import { withAuditUser } from "./audit";

const createDatabase = () => {
  const execute = vi
    .fn<(query: SQL) => Promise<unknown>>()
    .mockResolvedValue([]);
  const tx = { execute } as unknown as AppDb;
  const transaction = vi.fn((fn: (tx: AppDb) => Promise<unknown>) => fn(tx));
  const db = { transaction } as unknown as AppDb;
  return { db, tx, execute, transaction };
};

describe("withAuditUser", () => {
  it.each([
    {
      name: "an actor and SQL-looking source",
      context: { userId: 42, source: "api'); SELECT pg_sleep(1); --" },
      params: ["42", "api'); SELECT pg_sleep(1); --"],
    },
    {
      name: "null actor and source",
      context: { userId: null, source: null },
      params: ["", ""],
    },
    {
      name: "an omitted source",
      context: { userId: 7 },
      params: ["7", ""],
    },
  ])(
    "binds both transaction-local settings for $name",
    async ({ context, params }) => {
      const { db, tx, execute, transaction } = createDatabase();
      const callback = vi
        .fn<(tx: AppDb) => Promise<string>>()
        .mockResolvedValue("written");

      await expect(withAuditUser(db, context, callback)).resolves.toBe(
        "written",
      );

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(1);
      const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
      expect(query.sql.replace(/\s+/g, " ").trim()).toBe(
        "SELECT set_config('app.user_id', $1, true), set_config('app.source', $2, true)",
      );
      expect(query.params).toEqual(params);
      expect(callback).toHaveBeenCalledExactlyOnceWith(tx);
    },
  );

  it("waits for attribution setup before calling the writer", async () => {
    const { db, tx, execute } = createDatabase();
    let completeSetup!: () => void;
    const setup = new Promise<void>((resolve) => {
      completeSetup = resolve;
    });
    execute.mockReturnValueOnce(setup);
    const written = { id: 123 };
    const callback = vi
      .fn<(tx: AppDb) => Promise<typeof written>>()
      .mockResolvedValue(written);

    const result = withAuditUser(db, { userId: 42 }, callback);

    expect(callback).not.toHaveBeenCalled();
    completeSetup();
    await expect(result).resolves.toBe(written);
    expect(callback).toHaveBeenCalledExactlyOnceWith(tx);
  });

  it("preserves setup errors and never calls the writer", async () => {
    const { db, execute } = createDatabase();
    const error = new Error("Attribution setup failed");
    execute.mockRejectedValueOnce(error);
    const callback = vi.fn<(tx: AppDb) => Promise<void>>();

    await expect(withAuditUser(db, { userId: 42 }, callback)).rejects.toBe(
      error,
    );

    expect(callback).not.toHaveBeenCalled();
  });

  it("propagates the writer's error through the transaction", async () => {
    const { db, tx } = createDatabase();
    const error = new Error("Source write failed");
    const callback = vi
      .fn<(tx: AppDb) => Promise<void>>()
      .mockRejectedValue(error);

    await expect(withAuditUser(db, { userId: 42 }, callback)).rejects.toBe(
      error,
    );

    expect(callback).toHaveBeenCalledExactlyOnceWith(tx);
  });
});
