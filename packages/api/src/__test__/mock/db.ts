import { vi } from "vitest";

import type { Context } from "../../shared";

/**
 * Creates a mock database with chainable methods that tracks inserts/updates.
 * Simulates Drizzle ORM's query builder pattern.
 *
 * State (the in-memory store and id counter) is owned per call, so each test
 * gets an isolated database instance with no cross-test leakage.
 */
export const createMockDb = () => {
  // In-memory store to simulate database
  const mockDatabase = new Map<string, Record<string, unknown>>();
  let idCounter = 0;

  const mockReturning = vi.fn();

  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() => {
    return {
      returning: vi.fn().mockImplementation(() => {
        // Get the last inserted/updated record
        const records = Array.from(mockDatabase.values());
        const lastRecord = records[records.length - 1];
        return Promise.resolve(lastRecord ? [lastRecord] : []);
      }),
    };
  });

  const mockValues = vi
    .fn()
    .mockImplementation((data: Record<string, unknown>) => {
      // Store the data in our mock database
      const id = (data.id as string) || `generated-${++idCounter}`;
      const record = {
        ...data,
        id,
        created: new Date().toISOString(),
      };

      // Check if record exists (for upsert)
      const existingRecord = mockDatabase.get(id);
      if (existingRecord) {
        // Update existing record
        Object.assign(existingRecord, record);
        mockDatabase.set(id, existingRecord);
      } else {
        // Insert new record
        mockDatabase.set(id, record);
      }

      return {
        onConflictDoUpdate: mockOnConflictDoUpdate.mockImplementation(() => ({
          returning: vi.fn().mockResolvedValue([mockDatabase.get(id)]),
        })),
        returning: mockReturning.mockResolvedValue([mockDatabase.get(id)]),
      };
    });

  const mockInsert = vi.fn().mockReturnValue({
    values: mockValues,
  });

  const mockWhere = vi.fn().mockImplementation(() => {
    return Promise.resolve(Array.from(mockDatabase.values()));
  });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  // Resolves a select query to the current contents of the mock database —
  // except when `fields` (the object passed to `.select()`) contains a
  // `countDistinct` marker (see the @acme/db mock's `countDistinct`), in
  // which case it computes a real distinct count over the in-memory store
  // instead of returning raw rows. Predicates passed to `.where()` are
  // otherwise ignored here, same as everywhere else in this mock — tests
  // populate `_database` with only the rows relevant to what they assert.
  const resolveSelectRows = (fields?: Record<string, unknown>) => {
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value && typeof value === "object" && "__countDistinct" in value) {
          const column = (value as { __countDistinct: string }).__countDistinct;
          const distinct = new Set(
            Array.from(mockDatabase.values()).map((row) => row[column]),
          );
          return Promise.resolve([{ [key]: distinct.size }]);
        }
      }
    }
    return Promise.resolve(Array.from(mockDatabase.values()));
  };

  // Builds a chainable, awaitable select builder so handlers can compose
  // `.from().leftJoin().where()` (and plain `.from()` awaited directly) the
  // same way Drizzle's query builder does.
  const createSelectChain = (fields?: Record<string, unknown>) => {
    const chain = {
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      rightJoin: vi.fn(() => chain),
      fullJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn(() => resolveSelectRows(fields)),
      where: vi.fn(() => resolveSelectRows(fields)),
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?:
          ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?:
          ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => resolveSelectRows(fields).then(onfulfilled, onrejected),
    };
    return chain;
  };

  // `mockFrom` is shared across calls but must resolve rows for whichever
  // field spec the preceding `.select(fields)` call captured — closed over
  // per select() call via `selectFields`, reset immediately after `.from()`
  // reads it so unrelated selects (with no field spec) aren't affected.
  let selectFields: Record<string, unknown> | undefined;
  const mockFrom = vi.fn().mockImplementation(() => {
    const fields = selectFields;
    selectFields = undefined;
    return createSelectChain(fields);
  });
  const mockSelect = vi
    .fn()
    .mockImplementation((fields?: Record<string, unknown>) => {
      selectFields = fields;
      return { from: mockFrom };
    });

  const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });

  // Runs the callback with the same mock db so transactional handlers behave
  // like the non-transactional path in tests.
  const mockTransaction = vi.fn();

  const db = {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    delete: mockDelete,
    transaction: mockTransaction,
    _mocks: {
      mockInsert,
      mockValues,
      mockOnConflictDoUpdate,
      mockReturning,
      mockUpdate,
      mockSet,
      mockWhere,
      mockSelect,
      mockFrom,
      mockTransaction,
    },
    // Expose the database for assertions
    _database: mockDatabase,
  };

  mockTransaction.mockImplementation((callback: (tx: typeof db) => unknown) =>
    Promise.resolve(callback(db)),
  );

  return db;
};

export type MockDb = ReturnType<typeof createMockDb>;

/**
 * Casts the mock database to the Context["db"] type for use in tests.
 */
export const asMockContextDb = (mockDb: MockDb): Context["db"] => {
  return mockDb as unknown as Context["db"];
};
