import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrgFilter } from "./org-filter";

vi.mock("~/orpc/client", () => ({ client: { org: { accessible: vi.fn() } } }));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({ data: [] }),
}));

type SelectedOrg = Parameters<typeof OrgFilter>[0]["selectedOrgs"][number];
const orgs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
  })) as unknown as SelectedOrg[];

describe("event types org filter button", () => {
  it.each([
    [0, "Filter by org"],
    [1, "1 org selected"],
    [2, "2 orgs selected"],
  ])("labels %i selected orgs", (count, label) => {
    render(<OrgFilter onOrgSelect={vi.fn()} selectedOrgs={orgs(count)} />);

    expect(screen.getByRole("combobox").textContent).toBe(label);
  });
});
