import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import AdminApiKeysModal from "~/app/_components/modal/admin-api-keys-modal";

// jsdom has no ResizeObserver; Radix's Select/Dialog primitives need one.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        /* no-op */
      }
      unobserve() {
        /* no-op */
      }
      disconnect() {
        /* no-op */
      }
    },
  );
});

interface Org {
  id: number;
  name: string;
  orgType: string;
  parentId: number | null;
  roles: string[];
}

const { authMock, fetchAllPagesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  fetchAllPagesMock: vi.fn(),
}));

vi.mock("~/utils/hooks/use-auth", () => ({ useAuth: authMock }));

vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: fetchAllPagesMock,
}));

vi.mock("~/orpc/client", () => ({ client: {} }));

vi.mock("~/orpc/react", () => ({
  invalidateQueries: vi.fn(),
  ORPCError: class extends Error {},
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  orpc: {
    apiKey: { create: { mutationOptions: (opts: unknown) => opts } },
  },
}));

vi.mock("~/utils/store/modal", () => ({ closeModal: vi.fn() }));

// The real combobox only renders its options in a popover; list them inline so
// the test can read what the org picker offers.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({ options }: { options: { label: string }[] }) => (
    <ul data-testid="org-options">
      {options.map((o) => (
        <li key={o.label}>{o.label}</li>
      ))}
    </ul>
  ),
}));

const NATION: Org = {
  id: 1,
  name: "F3 Nation",
  orgType: "nation",
  parentId: null,
  roles: [],
};
const BOONE: Org = {
  id: 8,
  name: "Boone",
  orgType: "region",
  parentId: 1,
  roles: [],
};
const BOONE_AO: Org = {
  id: 81,
  name: "The Rock",
  orgType: "ao",
  parentId: 8,
  roles: [],
};
const CHARLOTTE: Org = {
  id: 9,
  name: "Charlotte",
  orgType: "region",
  parentId: 1,
  roles: [],
};
const CHARLOTTE_AO: Org = {
  id: 91,
  name: "The Yard",
  orgType: "ao",
  parentId: 9,
  roles: [],
};

const setup = ({
  sessionRoles,
  isNationAdmin = false,
  orgs,
}: {
  sessionRoles: { orgId: number; roleName: string }[];
  isNationAdmin?: boolean;
  orgs: Org[];
}) => {
  authMock.mockReturnValue({
    session: { roles: sessionRoles },
    isNationAdmin,
  });
  fetchAllPagesMock.mockReturnValue({ data: orgs, isLoading: false });
  render(<AdminApiKeysModal />);
};

const addRoleButton = () => screen.getByRole("button", { name: /add role/i });

const offeredOrgs = () => {
  fireEvent.click(addRoleButton());
  return within(screen.getByTestId("org-options"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
};

describe("AdminApiKeysModal org picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers a region admin their region and its AOs, not orgs they only edit", () => {
    setup({
      sessionRoles: [
        { orgId: 8, roleName: "admin" },
        { orgId: 9, roleName: "editor" },
      ],
      orgs: [
        { ...BOONE, roles: ["admin"] },
        BOONE_AO,
        { ...CHARLOTTE, roles: ["editor"] },
        CHARLOTTE_AO,
      ],
    });

    expect(offeredOrgs()).toEqual(["Boone (region)", "The Rock (ao)"]);
  });

  it("offers a Nation editor who is also a region admin their region, though org.accessible returns every org without roles", () => {
    setup({
      sessionRoles: [
        { orgId: 1, roleName: "editor" },
        { orgId: 8, roleName: "admin" },
      ],
      orgs: [NATION, BOONE, BOONE_AO, CHARLOTTE, CHARLOTTE_AO],
    });

    expect(offeredOrgs()).toEqual(["Boone (region)", "The Rock (ao)"]);
  });

  it("offers a Nation admin every org", () => {
    setup({
      sessionRoles: [{ orgId: 1, roleName: "admin" }],
      isNationAdmin: true,
      orgs: [NATION, BOONE, BOONE_AO, CHARLOTTE, CHARLOTTE_AO],
    });

    expect(offeredOrgs()).toHaveLength(5);
  });

  it("disables Add Role when the user administers no org", () => {
    setup({
      sessionRoles: [{ orgId: 9, roleName: "editor" }],
      orgs: [{ ...CHARLOTTE, roles: ["editor"] }, CHARLOTTE_AO],
    });

    expect(addRoleButton()).toHaveProperty("disabled", true);
  });
});
