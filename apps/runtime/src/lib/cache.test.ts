import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CacheEntry } from "./cache";
import { buildCacheMap, createHostnameCache, normalizeHostname } from "./cache";
import type { LogFields, LogSeverity, Logger } from "./logger";

interface CapturedLog {
  severity: LogSeverity;
  message: string;
  fields?: LogFields;
}

function createTestLogger(): {
  logger: Logger;
  entries: CapturedLog[];
} {
  const entries: CapturedLog[] = [];
  const push =
    (severity: LogSeverity) =>
    (message: string, fields?: LogFields): void => {
      entries.push({ severity, message, fields });
    };
  return {
    entries,
    logger: {
      debug: push("DEBUG"),
      info: push("INFO"),
      warn: push("WARNING"),
      error: push("ERROR"),
    },
  };
}

/**
 * Minimal fake scheduler — we collect the most recently registered
 * callback and expose a `tick()` helper that invokes it synchronously.
 * That lets tests drive refreshes without fake timers, which tangle
 * badly with awaited async fetchers.
 */
interface FakeScheduler {
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  tick: () => void;
  intervalMs: number | null;
  handles: unknown[];
}

function createFakeScheduler(): FakeScheduler {
  let currentCb: (() => void) | null = null;
  const handles: unknown[] = [];
  const fake: FakeScheduler = {
    intervalMs: null,
    handles,
    setInterval(cb, ms) {
      currentCb = cb;
      fake.intervalMs = ms;
      const handle = { id: Symbol("timer") };
      handles.push(handle);
      return handle;
    },
    clearInterval(handle) {
      const idx = handles.indexOf(handle);
      if (idx >= 0) handles.splice(idx, 1);
      currentCb = null;
    },
    tick() {
      if (currentCb) currentCb();
    },
  };
  return fake;
}

const entry = (hostname: string, slug: string, id: string): CacheEntry => ({
  id: `uuid-${slug}`,
  hostname,
  regionSlug: slug,
  regionId: id,
  lifecycleState: "active",
});

describe("normalizeHostname", () => {
  it("lowercases", () => {
    expect(normalizeHostname("F3Marshall.COM")).toBe("f3marshall.com");
  });

  it("strips a single trailing dot", () => {
    expect(normalizeHostname("f3marshall.com.")).toBe("f3marshall.com");
  });

  it("leaves already-normalized values untouched", () => {
    expect(normalizeHostname("f3marshall.com")).toBe("f3marshall.com");
  });
});

describe("buildCacheMap", () => {
  it("indexes entries by normalized hostname", () => {
    const map = buildCacheMap([
      entry("F3Marshall.com", "f3marshall", "1"),
      entry("f3muletown.com.", "f3muletown", "2"),
    ]);
    expect(map.get("f3marshall.com")?.regionSlug).toBe("f3marshall");
    expect(map.get("f3muletown.com")?.regionId).toBe("2");
  });
});

describe("createHostnameCache", () => {
  let logging: ReturnType<typeof createTestLogger>;

  beforeEach(() => {
    logging = createTestLogger();
  });

  it("cold start via refreshNow populates the map", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue([entry("f3marshall.com", "f3marshall", "1")]);
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler: createFakeScheduler(),
    });
    expect(cache.get("f3marshall.com")).toBeNull();
    await cache.refreshNow();
    expect(cache.getSize()).toBe(1);
    expect(cache.get("f3marshall.com")?.regionSlug).toBe("f3marshall");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("background refresh swaps the snapshot atomically", async () => {
    const fetcher = vi
      .fn<[], Promise<CacheEntry[]>>()
      .mockResolvedValueOnce([entry("one.example.com", "one", "101")])
      .mockResolvedValueOnce([
        entry("one.example.com", "one", "101"),
        entry("two.example.com", "two", "202"),
      ]);
    const scheduler = createFakeScheduler();
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler,
    });

    await cache.refreshNow();
    expect(cache.getSize()).toBe(1);

    cache.start();
    expect(scheduler.intervalMs).toBe(60_000);

    scheduler.tick();
    // Allow the queued promise chain to resolve.
    await vi.waitFor(() => {
      expect(cache.getSize()).toBe(2);
    });
    expect(cache.get("two.example.com")?.regionId).toBe("202");
  });

  it("refresh failure retains the last snapshot and logs WARNING", async () => {
    const fetcher = vi
      .fn<[], Promise<CacheEntry[]>>()
      .mockResolvedValueOnce([entry("good.example.com", "good", "1")])
      .mockRejectedValueOnce(new Error("neon unreachable"));
    const scheduler = createFakeScheduler();
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler,
    });

    await cache.refreshNow();
    expect(cache.getSize()).toBe(1);

    cache.start();
    scheduler.tick();
    await vi.waitFor(() => {
      const warns = logging.entries.filter((e) => e.severity === "WARNING");
      expect(warns.length).toBeGreaterThanOrEqual(1);
    });

    // Snapshot still has the good row — fail-open.
    expect(cache.getSize()).toBe(1);
    expect(cache.get("good.example.com")?.regionSlug).toBe("good");

    // Next tick recovers.
    fetcher.mockResolvedValueOnce([
      entry("good.example.com", "good", "1"),
      entry("new.example.com", "new", "2"),
    ]);
    scheduler.tick();
    await vi.waitFor(() => {
      expect(cache.getSize()).toBe(2);
    });
  });

  it("get() is case-insensitive and trailing-dot tolerant", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue([entry("f3marshall.com", "f3marshall", "1")]);
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler: createFakeScheduler(),
    });
    await cache.refreshNow();
    expect(cache.get("F3MARSHALL.COM")?.regionSlug).toBe("f3marshall");
    expect(cache.get("f3marshall.com.")?.regionSlug).toBe("f3marshall");
    expect(cache.get("F3Marshall.com.")?.regionSlug).toBe("f3marshall");
  });

  it("unknown hostname returns null", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue([entry("known.example.com", "known", "1")]);
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler: createFakeScheduler(),
    });
    await cache.refreshNow();
    expect(cache.get("mystery.example.com")).toBeNull();
  });

  it("stop() clears the scheduler handle", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const scheduler = createFakeScheduler();
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler,
    });
    cache.start();
    expect(scheduler.handles).toHaveLength(1);
    cache.stop();
    expect(scheduler.handles).toHaveLength(0);
  });

  it("refreshNow collapses concurrent calls to a single fetch", async () => {
    let resolveFetch: (v: CacheEntry[]) => void = () => undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<CacheEntry[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cache = createHostnameCache({
      fetcher,
      logger: logging.logger,
      scheduler: createFakeScheduler(),
    });

    const p1 = cache.refreshNow();
    const p2 = cache.refreshNow();
    resolveFetch([entry("collapsed.example.com", "collapsed", "1")]);
    await Promise.all([p1, p2]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getSize()).toBe(1);
  });
});
