import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "../../src/app/layout";

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

describe("layout app router", () => {
  it("should render layout", async () => {
    const { container } = render(
      <RootLayout>
        <div />
      </RootLayout>,
    );
    expect(container.querySelector("body")).toHaveClass(
      "min-h-dvh w-screen bg-background font-sans text-foreground antialiased",
    );
  });
});
