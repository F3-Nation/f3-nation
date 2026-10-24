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
  it("links to apps.f3nation.com in production", () => {
    render(<ProfileForm user={user} regions={[]} showAppsDirectory />);

    expect(
      screen.getByRole("link", { name: /apps\.f3nation\.com/ }),
    ).toHaveAttribute("href", "https://apps.f3nation.com");
  });

  it("leaves the card out elsewhere, since the directory only lists production apps", () => {
    render(<ProfileForm user={user} regions={[]} showAppsDirectory={false} />);

    expect(screen.queryByText("Explore F3 Nation")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /apps\.f3nation\.com/ }),
    ).toBeNull();
  });
});
