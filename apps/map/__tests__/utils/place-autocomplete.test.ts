import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { debouncedPlacesAutocomplete } from "~/utils/place-autocomplete";

vi.mock("~/utils/runtime-config", () => ({
  getGoogleApiKey: () => "test-key",
}));

describe("debouncedPlacesAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns and caches [] when the API omits suggestions", async () => {
    // Google leaves `suggestions` out entirely when nothing matches.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    const center = { lat: 0, lng: 0 };
    const callback = vi.fn();

    debouncedPlacesAutocomplete("zzz-no-match", center, 10, callback);
    await vi.advanceTimersByTimeAsync(300);
    expect(callback).toHaveBeenLastCalledWith([]);

    debouncedPlacesAutocomplete("zzz-no-match", center, 10, callback);
    await vi.advanceTimersByTimeAsync(300);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
