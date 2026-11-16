// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query";

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("is false where matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result, unmount } = renderHook(() => useMediaQuery("(x)"));
    expect(result.current).toBe(false);
    unmount();
  });

  it("follows the media query as it changes", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const { result, unmount } = renderHook(() => useMediaQuery("(x)"));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((fn) => fn());
    });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
