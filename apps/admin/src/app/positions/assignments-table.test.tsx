import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgType } from "@acme/shared/app/enums";

import { compareAssignmentOrgs } from "./assignment-org-order";

interface TestOrg {
  id: number;
  name: string;
  orgType: OrgType;
  roles: string[];
}

interface AssignmentsQueryInput {
  orgId: number;
}

const mocks = vi.hoisted(() => ({
  orgs: undefined as TestOrg[] | undefined,
  assignmentInputs: [] as AssignmentsQueryInput[],
}));

vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({ data: mocks.orgs }),
}));

vi.mock("~/orpc/client", () => ({ client: {} }));

vi.mock("~/orpc/react", () => ({
  orpc: {
    position: {
      getAssignments: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: AssignmentsQueryInput;
          enabled: boolean;
        }) => ({ input, enabled }),
      },
      deleteAssignment: { mutationOptions: () => ({}) },
      addAssignment: { mutationOptions: () => ({}) },
    },
    user: { byF3Name: { queryOptions: () => ({ enabled: false }) } },
  },
  useQuery: ({
    input,
    enabled,
  }: {
    input: AssignmentsQueryInput;
    enabled: boolean;
  }) => {
    if (enabled) mocks.assignmentInputs.push(input);
    return { data: { positions: [] }, isLoading: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  invalidateQueries: vi.fn(),
  ORPCError: class ORPCError extends Error {},
}));

vi.mock("~/utils/store/modal", () => ({
  DeleteType: { ASSIGNMENT: "assignment" },
  ModalType: { DELETE_CONFIRMATION: "delete-confirmation" },
  closeModal: vi.fn(),
  openModal: vi.fn(),
}));

// The real combobox virtualizes its options, which jsdom never lays out, so
// this stub shows the selected label and one button per option instead.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    options,
    value,
    onSelect,
  }: {
    options: { value: string; label: string }[];
    value?: string;
    onSelect: (value: string) => void;
  }) => (
    <div>
      <span data-testid="org-combobox-value">
        {options.find((option) => option.value === value)?.label ?? ""}
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={`org-option-${option.value}`}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

import { AssignmentsTable } from "./assignments-table";

// Given out of order so the default only lands on the right org if the
// component sorts before picking.
const makeOrgs = (): TestOrg[] => [
  { id: 1, name: "Zulu", orgType: "region", roles: [] },
  { id: 2, name: "Bravo", orgType: "sector", roles: [] },
  { id: 3, name: "Alpha", orgType: "sector", roles: [] },
];

const expectedDefault = makeOrgs().sort(compareAssignmentOrgs)[0]!;

const latestAssignmentsInput = () =>
  mocks.assignmentInputs[mocks.assignmentInputs.length - 1];

describe("AssignmentsTable default organization", () => {
  beforeEach(() => {
    mocks.orgs = makeOrgs();
    mocks.assignmentInputs = [];
  });

  it("sorts Alpha (sector) first among the fixture orgs", () => {
    expect(expectedDefault.id).toBe(3);
  });

  it("picks the first sorted org by default", () => {
    render(<AssignmentsTable />);

    expect(latestAssignmentsInput()).toEqual({ orgId: expectedDefault.id });
    expect(screen.getByTestId("org-combobox-value").textContent).toBe(
      "(SECTOR) Alpha",
    );
  });

  it("picks the default once the org list arrives", () => {
    mocks.orgs = undefined;
    const { rerender } = render(<AssignmentsTable />);

    expect(mocks.assignmentInputs).toEqual([]);

    mocks.orgs = makeOrgs();
    rerender(<AssignmentsTable />);

    expect(latestAssignmentsInput()).toEqual({ orgId: expectedDefault.id });
  });

  it("keeps the user's choice when the org list is refetched", () => {
    const { rerender } = render(<AssignmentsTable />);

    fireEvent.click(screen.getByTestId("org-option-2"));
    expect(latestAssignmentsInput()).toEqual({ orgId: 2 });

    mocks.orgs = makeOrgs();
    rerender(<AssignmentsTable />);

    expect(latestAssignmentsInput()).toEqual({ orgId: 2 });
    expect(screen.getByTestId("org-combobox-value").textContent).toBe(
      "(SECTOR) Bravo",
    );
  });

  it("runs no assignments query when no orgs are accessible", () => {
    mocks.orgs = [];
    render(<AssignmentsTable />);

    expect(mocks.assignmentInputs).toEqual([]);
  });
});
