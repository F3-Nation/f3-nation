import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RoleBadges } from "./role-badges";

afterEach(cleanup);

describe("RoleBadges", () => {
  it("shows one badge per org listing its roles, most access first", () => {
    render(
      <RoleBadges
        roles={[
          { orgId: 8, orgName: "Boone", roleName: "password_manager" },
          { orgId: 1, orgName: "F3 Nation", roleName: "editor" },
          { orgId: 8, orgName: "Boone", roleName: "admin" },
        ]}
      />,
    );

    expect(screen.getAllByText(/\(/).map((badge) => badge.textContent)).toEqual(
      ["Boone (Admin, Password Manager)", "F3 Nation (Editor)"],
    );
  });

  it("names an org it has no name for by its id", () => {
    render(<RoleBadges roles={[{ orgId: 5, roleName: "editor" }]} />);

    expect(screen.getByText("Org #5 (Editor)")).toBeTruthy();
  });
});
