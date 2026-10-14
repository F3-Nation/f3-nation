/**
 * triggerMapAppRevalidation clears this instance's map dataset cache, so the
 * instance that just saved an edit stops serving the old map data at once
 * (other instances catch up within MAP_DATA_TTL_MS). The clear runs before the
 * config check and the HTTP call, so it holds even when those fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `src/__tests__/setup.ts` mocks this module for every API suite; this is the
// one place that needs the real implementation.
vi.unmock("./revalidate-map");

const { env } = vi.hoisted(() => {
  const env: { NEXT_PUBLIC_MAP_URL?: string; SUPER_ADMIN_API_KEY: string } = {
    NEXT_PUBLIC_MAP_URL: "https://map.example.test/",
    SUPER_ADMIN_API_KEY: "test-key",
  };
  return { env };
});
vi.mock("@acme/env", () => ({ env }));

import { cachedMapData, clearMapDataCache } from "./map-data-cache";
import { triggerMapAppRevalidation } from "./revalidate-map";

const seedThenRevalidate = async () => {
  await cachedMapData("eventsAndLocations", () => Promise.resolve("old"));
  await triggerMapAppRevalidation();
  const reload = vi.fn().mockResolvedValue("new");
  const value = await cachedMapData("eventsAndLocations", reload);
  return { reload, value };
};

describe("triggerMapAppRevalidation", () => {
  beforeEach(() => {
    clearMapDataCache();
    env.NEXT_PUBLIC_MAP_URL = "https://map.example.test/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the cache and calls the map's revalidate endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    const { reload, value } = await seedThenRevalidate();

    expect(reload).toHaveBeenCalledOnce();
    expect(value).toBe("new");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://map.example.test/api/revalidate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears the cache even when the map URL isn't configured", async () => {
    env.NEXT_PUBLIC_MAP_URL = undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { reload } = await seedThenRevalidate();

    expect(reload).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the cache even when the revalidate call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    const { reload } = await seedThenRevalidate();

    expect(reload).toHaveBeenCalledOnce();
  });
});
