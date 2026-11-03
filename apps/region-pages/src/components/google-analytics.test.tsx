import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleAnalytics } from "@/components/google-analytics";

const mockEnv = vi.hoisted(() => ({
  F3_CHANNEL: "prod",
  GA_MEASUREMENT_ID: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

vi.mock("next/script", () => ({
  default: ({ src, id }: { src?: string; id?: string }) => (
    <script data-src={src} data-id={id} />
  ),
}));

const PROD_GTAG_SRC =
  "https://www.googletagmanager.com/gtag/js?id=G-44DEXNRMCP";

afterEach(() => {
  cleanup();
  mockEnv.F3_CHANNEL = "prod";
  mockEnv.GA_MEASUREMENT_ID = undefined;
});

describe("GoogleAnalytics", () => {
  it("reports prod to the existing GA property when no id is configured", () => {
    mockEnv.F3_CHANNEL = "prod";

    const { container } = render(<GoogleAnalytics />);

    expect(container.querySelector("script[data-src]")).toHaveAttribute(
      "data-src",
      PROD_GTAG_SRC,
    );
  });

  it("renders nothing on staging when no id is configured", () => {
    mockEnv.F3_CHANNEL = "staging";

    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each(["staging", "prod"])(
    "uses an explicit GA_MEASUREMENT_ID over the default on %s",
    (channel) => {
      mockEnv.F3_CHANNEL = channel;
      mockEnv.GA_MEASUREMENT_ID = "G-TEST123";

      const { container } = render(<GoogleAnalytics />);

      expect(container.querySelector("script[data-src]")).toHaveAttribute(
        "data-src",
        "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
      );
      expect(container.innerHTML).not.toContain("G-44DEXNRMCP");
    },
  );
});
