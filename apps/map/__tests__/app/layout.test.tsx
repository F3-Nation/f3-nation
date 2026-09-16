// Mock setups use vi.fn() with untyped callbacks — unsafe rules don't apply here
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { isValidElement } from "react";
import type { ReactElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Layout pulls `useUpcomingInstances` (Sentry). `vi.resetModules()` below can
// re-evaluate the real package unless this file mocks it itself.
vi.mock("@sentry/nextjs", async () => import("../mocks/sentry-nextjs"));

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
// instrumentation and parallel workspace transforms enough headroom.
const layoutImportTimeout = 30_000;

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

  it("rejects a malformed configured map URL", async () => {
    vi.stubEnv("F3_MAP_BASE_URL", "not-a-url");

    await expect(import("../../src/app/map-metadata")).rejects.toThrow(
      /Invalid URL/,
    );
  });
});

describe("layout app router", () => {
  it(
    "should render layout",
    async () => {
      const { default: RootLayout } = await import("../../src/app/layout");
      const layoutResult = RootLayout({ children: <div /> });
      expect(isValidElement(layoutResult)).toBe(true);
      expect(layoutResult.type).toBe("html");

      const body = (layoutResult.props as { children: ReactElement }).children;
      expect(isValidElement(body)).toBe(true);
      expect(body.type).toBe("body");

      const bodyProps = body.props as {
        className?: string;
        children: React.ReactNode;
      };
      if (bodyProps.className) {
        document.body.className = bodyProps.className;
      }

      // RTL cannot mount a root <html> tree: a DIV container warns
      // "html cannot be a child of div", and documentElement warns
      // "html cannot be a child of html". Mount the body contents instead
      // and copy body class names onto the real document.body.
      render(bodyProps.children);
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
