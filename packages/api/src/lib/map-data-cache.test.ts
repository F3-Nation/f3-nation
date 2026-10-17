import { beforeEach, describe, expect, it, vi } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

import {
  cachedMapData,
  clearMapDataCache,
  MAP_DATA_TTL_MS,
  mapDataFor,
} from "./map-data-cache";

describe("cachedMapData", () => {
  beforeEach(() => clearMapDataCache());

  it("loads once per TTL window", async () => {
    let t = 1_000;
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");

    expect(await cachedMapData("k", load, () => t)).toBe("a");
    t += MAP_DATA_TTL_MS - 1;
    expect(await cachedMapData("k", load, () => t)).toBe("a");
    expect(load).toHaveBeenCalledTimes(1);

    t += 1;
    expect(await cachedMapData("k", load, () => t)).toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent misses", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const first = cachedMapData("k", load);
    const second = cachedMapData("k", load);
    resolve("x");

    expect(await first).toBe("x");
    expect(await second).toBe("x");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps keys separate", async () => {
    expect(await cachedMapData("a", () => Promise.resolve(1))).toBe(1);
    expect(await cachedMapData("b", () => Promise.resolve(2))).toBe(2);
  });

  it("does not cache a failed load", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce("ok");

    await expect(cachedMapData("k", load)).rejects.toThrow("db down");
    expect(await cachedMapData("k", load)).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("clear forces a reload, and a load from before the clear isn't kept", async () => {
    let resolve!: (v: string) => void;
    const stale = cachedMapData(
      "k",
      () => new Promise<string>((r) => (resolve = r)),
    );
    clearMapDataCache();
    resolve("before-clear");
    expect(await stale).toBe("before-clear");

    const load = vi.fn().mockResolvedValue("after-clear");
    expect(await cachedMapData("k", load)).toBe("after-clear");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never serves the map's SSG/ISR render from the cache", async () => {
    const ssg = new Headers({ [Header.Client]: Client.ORPC_SSG });
    const api = new Headers({ [Header.Client]: Client.ORPC });
    await mapDataFor(api, "k", () => Promise.resolve("cached"));

    expect(await mapDataFor(api, "k", () => Promise.resolve("fresh"))).toBe(
      "cached",
    );
    expect(await mapDataFor(ssg, "k", () => Promise.resolve("fresh"))).toBe(
      "fresh",
    );
  });
});
