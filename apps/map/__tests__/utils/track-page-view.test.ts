import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-TEST123" },
}));

import { trackPageView } from "~/utils/analytics/functions";

describe("trackPageView", () => {
  afterEach(() => {
    // @ts-expect-error test-only global
    delete window.gtag;
  });

  it("configures gtag with the page path when gtag and a measurement id are present", () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    trackPageView("/nation/some-region");

    expect(gtag).toHaveBeenCalledWith("config", "G-TEST123", {
      page_path: "/nation/some-region",
    });
  });

  it("does nothing when gtag is not on the window", () => {
    expect(() => trackPageView("/nation/some-region")).not.toThrow();
  });
});
