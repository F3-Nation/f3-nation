// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type * as OrgChart from "./org-chart";
import { writeUrlState } from "./url-state";

vi.mock("./org-chart", async (importOriginal) => {
  const actual = await importOriginal<typeof OrgChart>();
  return { ...actual, LAYER_TYPES: ["region", "area"] };
});

afterEach(() => window.history.replaceState(null, "", "./"));

it("omits the configured broadest layer even when it is not sector", () => {
  writeUrlState("area", 42);
  expect(new URLSearchParams(window.location.search).has("level")).toBe(false);
  expect(new URLSearchParams(window.location.search).get("org")).toBe("42");
  writeUrlState("region", null);
  expect(new URLSearchParams(window.location.search).get("level")).toBe(
    "regions",
  );
});
