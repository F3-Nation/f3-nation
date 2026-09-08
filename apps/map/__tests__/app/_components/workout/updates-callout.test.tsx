import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UpdateInstance } from "~/app/_components/workout/updates-callout";
import { UpdatesCallout } from "~/app/_components/workout/updates-callout";

const instance = (overrides: Partial<UpdateInstance> = {}): UpdateInstance => ({
  id: 1,
  startDate: "2026-09-02",
  startTime: "0615",
  seriesException: "different-time",
  ...overrides,
});

describe("UpdatesCallout", () => {
  it("renders nothing when there are no updates", () => {
    const { container } = render(<UpdatesCallout instances={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the changes, singular and plural", () => {
    const { unmount } = render(<UpdatesCallout instances={[instance()]} />);
    expect(screen.getByText("1 upcoming change")).toBeTruthy();
    unmount();

    render(
      <UpdatesCallout
        instances={[instance(), instance({ id: 2, startDate: "2026-09-09" })]}
      />,
    );
    expect(screen.getByText("2 upcoming changes")).toBeTruthy();
  });

  it("names the status and date of each change", () => {
    render(
      <UpdatesCallout
        instances={[
          instance(),
          instance({
            id: 2,
            startDate: "2026-09-09",
            seriesException: "closed",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Different time")).toBeTruthy();
    expect(screen.getByText(/9\/2 at 6:15AM/)).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("withholds the stored time on a closure", () => {
    // A closed instance still carries a start time; printing it would read as
    // "come at 6:15" for a workout that is not happening.
    render(
      <UpdatesCallout
        instances={[instance({ seriesException: "closed", startTime: "0615" })]}
      />,
    );
    expect(screen.queryByText(/6:15/)).toBeNull();
    expect(screen.getByText(/9\/2/)).toBeTruthy();
  });

  it("keeps the card neutral regardless of the changes it holds", () => {
    // Tinting the card to one change would make the whole block read as that
    // status, when the list can hold several at once.
    const cardClass = (instances: UpdateInstance[]) => {
      const { container, unmount } = render(
        <UpdatesCallout instances={instances} />,
      );
      const className = container.querySelector("[role=alert]")?.className;
      unmount();
      return className;
    };

    const differentTime = cardClass([instance()]);
    const closed = cardClass([instance({ seriesException: "closed" })]);
    const mixed = cardClass([
      instance({ seriesException: "closed" }),
      instance({ id: 2, startDate: "2026-09-09" }),
    ]);

    expect(differentTime).toBe(closed);
    expect(differentTime).toBe(mixed);
    for (const hue of ["orange", "gray", "green", "purple"]) {
      expect(differentTime).not.toContain(hue);
    }
  });

  it("still colors each row's swatch by its own status", () => {
    const { container } = render(
      <UpdatesCallout
        instances={[
          instance(),
          instance({
            id: 2,
            startDate: "2026-09-09",
            seriesException: "closed",
          }),
        ]}
      />,
    );
    // div, not [aria-hidden] alone — the lucide icon carries that too, and an
    // SVG's className is an SVGAnimatedString rather than a string.
    const swatches = Array.from(
      container.querySelectorAll("div[aria-hidden=true]"),
    ).map((node) => node.className);
    expect(swatches.some((c) => c.includes("orange"))).toBe(true);
    expect(swatches.some((c) => c.includes("gray"))).toBe(true);
  });
});
