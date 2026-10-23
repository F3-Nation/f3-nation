import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultRegionDescription,
  useRegionDescription,
} from "@/lib/region-description";

const renderedText = (description: string | null | undefined) => {
  const nodes = renderHook(() => useRegionDescription(description)).result
    .current;
  return render(<p>{nodes}</p>).container;
};

describe("useRegionDescription", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([undefined, null, "", "   "])(
    "uses the default for %j",
    (description) => {
      expect(renderedText(description).textContent).toBe(
        defaultRegionDescription,
      );
    },
  );

  it.each(["<p></p>", "<img src=x onerror=alert(1)>", "<div><br></div>"])(
    "uses the default, not the raw markup, for %j",
    (description) => {
      const container = renderedText(description);

      expect(container.textContent).toBe(defaultRegionDescription);
      expect(container.querySelector("img")).toBeNull();
    },
  );

  it("renders the sanitized description when it has text", () => {
    const container = renderedText(
      '<p>Hi <a href="https://f3boone.com">site</a></p>',
    );

    expect(container.textContent).toBe("Hi site");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://f3boone.com",
    );
  });
});
