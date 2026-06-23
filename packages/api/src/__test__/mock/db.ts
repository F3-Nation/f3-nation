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

  // Resolves a select query to the current contents of the mock database.
  const resolveSelectRows = () =>
    Promise.resolve(Array.from(mockDatabase.values()));

  // Builds a chainable, awaitable select builder so handlers can compose
  // `.from().leftJoin().where()` (and plain `.from()` awaited directly) the
  // same way Drizzle's query builder does.
  const createSelectChain = () => {
    const chain = {
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      rightJoin: vi.fn(() => chain),
      fullJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn(() => resolveSelectRows()),
      where: vi.fn(() => resolveSelectRows()),
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?:
          | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) => resolveSelectRows().then(onfulfilled, onrejected),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation(() => createSelectChain());
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });

  return {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    delete: mockDelete,
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
    },
    // Expose the database for assertions
    _database: mockDatabase,
  };
};

export type MockDb = ReturnType<typeof createMockDb>;

/**
 * Casts the mock database to the Context["db"] type for use in tests.
 */
export const asMockContextDb = (mockDb: MockDb): Context["db"] => {
  return mockDb as unknown as Context["db"];
};
