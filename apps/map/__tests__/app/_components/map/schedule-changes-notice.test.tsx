/**
 * The notice exists because the alternative signal is an absence: with the
 * exception list missing, an unflagged pin and an empty "upcoming changes" list
 * both read as "running as scheduled".
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface HookResult {
  instances: unknown;
  isUnavailable: boolean;
}

const { hookResult } = vi.hoisted(() => {
  const hookResult: { current: HookResult } = {
    current: { instances: undefined, isUnavailable: false },
  };
  return { hookResult };
});

vi.mock("~/utils/hooks/use-upcoming-instances", () => ({
  useUpcomingInstances: () => hookResult.current,
}));

import { ScheduleChangesNotice } from "~/app/_components/map/schedule-changes-notice";

const notice = () => screen.queryByRole("status");

describe("ScheduleChangesNotice", () => {
  beforeEach(() => {
    hookResult.current = { instances: [], isUnavailable: false };
  });

  it("stays out of the way while the exception list is fine", () => {
    render(<ScheduleChangesNotice />);

    expect(notice()).toBeNull();
  });

  it("says so when the exception list is unavailable", () => {
    hookResult.current = { instances: undefined, isUnavailable: true };

    render(<ScheduleChangesNotice />);

    expect(notice()?.textContent).toBe(
      "Some schedule changes may not be showing",
    );
  });

  it("takes a className so the same notice fits the map and the panel", () => {
    hookResult.current = { instances: undefined, isUnavailable: true };

    render(<ScheduleChangesNotice className="w-full" />);

    expect(notice()?.className).toContain("w-full");
  });
});
