// Mock setups use vi.fn() with untyped callbacks — unsafe rules don't apply here
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RootLayout mounts RuntimeConfigProvider, which fetches /api/runtime-config on
// mount. Stub it so the suite doesn't hit an unmocked (and unresolvable)
// relative URL, and so the bootstrap path is exercised with real config shape.
const runtimeConfigFetchMock = vi.fn().mockResolvedValue({
  ok: true,
  json: () =>
    Promise.resolve({ channel: "local", googleApiKey: "", adminUrl: "" }),
});
vi.stubGlobal("fetch", runtimeConfigFetchMock);

// This test cold-imports the full layout provider tree. Give coverage
// instrumentation more headroom than Vitest's unit-test default.
const layoutImportTimeout = 10_000;

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("geist/font/mono", () => ({
  GeistMono: {
    variable: vi.fn(),
  },
}));

vi.mock("geist/font/sans", () => ({
  GeistSans: {
    variable: vi.fn(),
  },
}));

// Mock the geolocation API
const geolocationMock = {
  getCurrentPosition: vi.fn().mockImplementation((success) =>
    success({
      coords: {
        latitude: 51.1,
        longitude: 45.3,
      },
    }),
  ),
};

// Mock the permissions API
const permissionsMock = {
  query: vi.fn().mockResolvedValue({ state: "granted" }),
};

// Override the navigator object
Object.defineProperty(global, "navigator", {
  value: {
    geolocation: geolocationMock,
    permissions: permissionsMock,
  },
  writable: true,
});

vi.mock("navigator", () => {
  return {
    permissions: {
      query: vi.fn(),
    },
    geolocation: {
      getCurrentPosition: vi.fn(),
    },
  };
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Re-stub fetch and environment validation before every test so the suite is
// independent of ambient process settings. Reset modules so layout reads the
// environment only after these stubs are installed.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("CI", "");
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
  vi.stubEnv("npm_lifecycle_event", "");
  vi.stubGlobal("fetch", runtimeConfigFetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("layout metadata base URL", () => {
  it("uses the configured map URL", async () => {
    vi.stubEnv("F3_MAP_BASE_URL", "https://map.example.com");

    const { mapMetadata } = await import("../../src/app/map-metadata");

    expect(mapMetadata.metadataBase).toEqual(
      new URL("https://map.example.com"),
    );
    expect(mapMetadata.openGraph?.url).toEqual(
      new URL("https://map.example.com"),
    );
  });

  it("falls back to localhost when the map URL is unavailable", async () => {
    vi.stubEnv("F3_MAP_BASE_URL", "");

    const { mapMetadata } = await import("../../src/app/map-metadata");

    expect(mapMetadata.metadataBase).toEqual(new URL("http://localhost:3000"));
    expect(mapMetadata.openGraph?.url).toEqual(
      new URL("http://localhost:3000"),
    );
  });
});

describe("layout app router", () => {
  it(
    "should render layout",
    async () => {
      const { default: RootLayout } = await import("../../src/app/layout");
      const layoutResult = RootLayout({ children: <div /> });
      render(layoutResult);
      // React 19 treats <html>/<body> as singleton host components and applies
      // their props to the real document elements instead of nesting them inside
      // the render container, so assert against document.body.
      expect(document.querySelector("body")).toHaveClass(
        "min-h-dvh w-screen bg-background font-sans text-foreground antialiased",
      );
      await waitFor(() =>
        expect(runtimeConfigFetchMock).toHaveBeenCalledWith(
          "/api/runtime-config",
        ),
      );
    },
    layoutImportTimeout,
  );
});
