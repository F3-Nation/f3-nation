import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { UserProfile } from "@/lib/types";
import { ProfileForm } from "../profile-form";

vi.mock("@/components/avatar-upload", () => ({ AvatarUpload: () => null }));
vi.mock("@/components/region-select", () => ({ RegionSelect: () => null }));
vi.mock("@/components/user-select", () => ({ UserSelect: () => null }));
vi.mock("@/components/role-list", () => ({ RoleList: () => null }));
vi.mock("@/components/position-list", () => ({ PositionList: () => null }));

const user: UserProfile = {
  id: 1,
  f3Name: "Dredd",
  firstName: "Patrick",
  lastName: "Smith",
  email: "dredd@f3nation.com",
  emailVerified: null,
  phone: "555-1234",
  homeRegionId: 10,
  avatarUrl: null,
  meta: null,
  emergencyContact: "Jane",
  emergencyPhone: "555-5678",
  emergencyNotes: "No allergies",
  status: "active",
  roles: [],
  positions: [],
  created: "2024-01-01",
  updated: "2024-06-01",
};

afterEach(cleanup);

describe("ProfileForm apps directory card", () => {
  it("links to the configured directory, labeled with its host", () => {
    render(
      <ProfileForm
        user={user}
        regions={[]}
        appsDirectoryUrl="https://staging.apps.f3nation.com/"
      />,
    );

    expect(
      screen.getByRole("link", { name: /staging\.apps\.f3nation\.com/ }),
    ).toHaveAttribute("href", "https://staging.apps.f3nation.com/");
  });

  it("leaves the card out when there is no directory URL", () => {
    render(<ProfileForm user={user} regions={[]} appsDirectoryUrl={null} />);

    expect(screen.queryByText("Explore F3 Nation")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /apps\.f3nation\.com/ }),
    ).toBeNull();
  });
});
