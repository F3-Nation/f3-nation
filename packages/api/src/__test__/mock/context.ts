import type { Context } from "../../shared";
import type { MockDb } from "./db";
import { asMockContextDb, createMockDb } from "./db";
import { createMockSession } from "./session";

export interface MockContext {
  ctx: Context;
  mockDb: MockDb;
}

/**
 * Creates a mock context with a mock database and session for testing.
 */
export const createMockContext = (
  sessionOverrides: Parameters<typeof createMockSession>[0] = {},
): MockContext => {
  const mockDb = createMockDb();
  return {
    ctx: {
      session: createMockSession(sessionOverrides),
      db: asMockContextDb(mockDb),
    },
    mockDb,
  };
};
