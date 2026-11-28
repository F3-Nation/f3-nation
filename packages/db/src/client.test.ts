import { afterEach, beforeEach, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({
  createDbClient: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("./utils/functions", () => factory);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  global.db = null;
});
afterEach(() => {
  global.db = null;
  vi.unstubAllEnvs();
});

it("opts the API into recovery lazily and exposes its liveness and shutdown", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const check = vi.fn().mockResolvedValue(undefined);
  const isLive = vi.fn().mockReturnValue(false);
  const database = {
    answer: 42,
    execute() {
      return this.answer;
    },
  };
  factory.createDbClient.mockReturnValue({
    db: database,
    close,
    isLive,
    check,
  });
  const client = await import("./client");
  client.enableDbRecovery();
  expect(client.isDbLive()).toBe(true);
  expect(factory.createDbClient).not.toHaveBeenCalled();
  expect((client.db as unknown as typeof database).execute()).toBe(42);
  expect(factory.createDbClient).toHaveBeenCalledExactlyOnceWith({
    recover: true,
  });
  expect(client.isDbLive()).toBe(false);
  await client.checkDb();
  expect(check).toHaveBeenCalledTimes(1);
  await client.closeDb();
  expect(close).toHaveBeenCalledTimes(1);
  expect(factory.getDb).not.toHaveBeenCalled();
  expect(() => client.enableDbRecovery()).toThrow("before first database use");
});

it("keeps non-API development clients on their shared default pool", async () => {
  vi.stubEnv("NODE_ENV", "development");
  factory.getDb.mockReturnValue({ answer: 7 });
  const client = await import("./client");
  expect((client.db as unknown as { answer: number }).answer).toBe(7);
  expect((client.db as unknown as { answer: number }).answer).toBe(7);
  expect(factory.getDb).toHaveBeenCalledTimes(1);
  expect(factory.createDbClient).not.toHaveBeenCalled();
  await client.closeDb();
});

it("does not initialize a pool after shutdown begins", async () => {
  const client = await import("./client");
  client.enableDbRecovery();
  await client.closeDb();
  expect(() => Reflect.get(client.db, "execute")).toThrow("shutting down");
  expect(factory.createDbClient).not.toHaveBeenCalled();
  expect(() => client.checkDb()).toThrow("shutting down");
});

it("requires recovery opt-in for physical health probes", async () => {
  factory.getDb.mockReturnValue({});
  const client = await import("./client");
  expect(() => client.checkDb()).toThrow("Database recovery is not enabled");
});

it("initializes recovery when the first database use is a health probe", async () => {
  const check = vi.fn().mockResolvedValue(undefined);
  factory.createDbClient.mockReturnValue({ db: {}, check });
  const client = await import("./client");
  client.enableDbRecovery();
  await client.checkDb();
  expect(factory.createDbClient).toHaveBeenCalledExactlyOnceWith({
    recover: true,
  });
  expect(check).toHaveBeenCalledTimes(1);
});
