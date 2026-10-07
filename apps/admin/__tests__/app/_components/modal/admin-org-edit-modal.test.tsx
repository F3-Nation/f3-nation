import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { ORPCError } from "@orpc/client";

import AdminOrgEditModal from "~/app/_components/modal/admin-org-edit-modal";
import OrgPage from "~/app/[orgSegment]/page";
import { orgAdminConfig } from "~/app/_components/org/org-admin-config";
import { AdminNavLinks } from "~/app/_components/admin-nav-links";
import { useOpenModal } from "~/utils/store/modal";
import { DeleteType, ModalType } from "~/utils/store/modal";
import type * as ModalStore from "~/utils/store/modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  parentById: vi.fn<(input: unknown) => Promise<unknown>>(),
  canEditRegions: vi.fn<(input: unknown) => Promise<unknown>>(),
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
  save: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("~/utils/image/upload-logo", () => ({ uploadLogo: mocks.upload }));
vi.mock("~/app/_components/debounced-image", () => ({
  DebouncedImage: ({
    src,
    alt,
    onImageFail,
    onImageSuccess,
  }: {
    src: string;
    alt: string;
    onImageFail: () => void;
    onImageSuccess: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- Test primitive exposes image load/error events.
    <img src={src} alt={alt} onError={onImageFail} onLoad={onImageSuccess} />
  ),
}));
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    onSelect,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onSelect(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => "/territories",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("~/utils/hooks/use-auth", () => ({
  useAuth: () => ({ isNationAdmin: false }),
}));
vi.mock("~/app/admin-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@acme/ui/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("~/utils/store/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof ModalStore>()),
  closeModal: mocks.close,
  openModal: mocks.open,
}));

// Keep real forms, schemas and React Query. Only the API boundary is replaced.
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: mocks.invalidate,
  orpc: {
    org: {
      byId: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled: boolean;
        }) => ({
          queryKey: ["org", "byId", input],
          queryFn: () =>
            input && typeof input === "object" && "orgType" in input
              ? mocks.byId(input)
              : mocks.parentById(input),
          enabled,
        }),
      },
      all: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled?: boolean;
        }) => ({
          enabled,
          queryKey: ["org", "all", input],
          queryFn: () => mocks.all(input),
        }),
      },
      crupdate: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: (input: Record<string, unknown>) => mocks.save(input),
        }),
      },
    },
    request: {
      canEditRegions: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled: boolean;
        }) => ({
          queryKey: ["request", "canEditRegions", input],
          queryFn: () => mocks.canEditRegions(input),
          enabled,
        }),
      },
    },
  },
}));
// useFetchAllPages (used for the parent-options dropdown) calls the
// imperative client directly rather than going through orpc.org.all's
// queryOptions -- route it to the same mocks.all so existing
// mocks.all.mockResolvedValue/mockImplementation setups still apply.
vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

// Popover layout/focus are browser concerns. Native selects exercise the same
// controlled value, option ordering and onValueChange contract in jsdom.
vi.mock("@acme/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  // A disabled option stands in for a group title so option order stays visible.
  SelectLabel: ({ children }: { children: ReactNode }) => (
    <option disabled value="">
      {children}
    </option>
  ),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@acme/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const record = {
  id: 40,
  name: "Example Org",
  parentId: 2,
  defaultLocationId: 8,
  isActive: true,
  description: "Description",
  logoUrl: "https://example.com/logo.png",
  website: "https://example.com",
  email: "org@example.com",
  phone: "555-0100",
  twitter: null,
  facebook: null,
  instagram: null,
  lastAnnualReview: "2026-08-01",
  meta: { region_location_short_description: "Keep this metadata" },
};
const parents = [
  { id: 2, name: "Zulu", orgType: "sector", isActive: true },
  { id: 3, name: "Alpha", orgType: "sector", isActive: true },
];
const clients: QueryClient[] = [];

function mount(
  type: "nation" | "sector" | "territory" | "area" | "region" | "ao",
  id?: number,
  isProd = true,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AdminOrgEditModal orgType={type} id={id} isProd={isProd} />
    </QueryClientProvider>,
  );
}
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
const parentSelect = () =>
  screen.getAllByRole<HTMLSelectElement>("combobox")[0]!;
const parentOptions = () =>
  Array.from(parentSelect().options).filter((option) => !option.disabled);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.byId.mockResolvedValue({ org: record });
  mocks.parentById.mockResolvedValue({ org: null });
  mocks.canEditRegions.mockResolvedValue({ results: [{ success: true }] });
  mocks.all.mockResolvedValue({ orgs: parents });
  mocks.save.mockResolvedValue({ org: record });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe.each([
  {
    type: "territory" as const,
    label: "Territory",
    parentTypes: ["sector"],
    initialName: "",
    deletion: DeleteType.ORG,
  },
  {
    type: "sector" as const,
    label: "Sector",
    parentTypes: ["nation"],
    initialName: "Unknown",
    deletion: DeleteType.ORG,
  },
  {
    type: "area" as const,
    label: "Area",
    parentTypes: ["sector", "territory"],
    initialName: "",
    deletion: DeleteType.ORG,
  },
])("$label editor", ({ type, label, parentTypes, initialName, deletion }) => {
  it("loads the record and sorted parent options with the current selection", async () => {
    mount(type, record.id);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(screen.getByRole("heading").textContent).toBe(`Edit ${label}`);
    expect(field("ID").disabled).toBe(true);
    expect(field("ID").value).toBe("40");
    await waitFor(() => expect(parentOptions().length).toBe(2));
    expect(parentOptions().map((option) => option.text)).toEqual([
      "Alpha",
      "Zulu",
    ]);
    expect(parentSelect().value).toBe("2");
    expect(mocks.byId).toHaveBeenCalledWith({ id: 40, orgType: type });
    expect(mocks.all).toHaveBeenCalledWith({
      orgTypes: parentTypes,
      pageIndex: 0,
      pageSize: 100,
    });
  });

  it("creates with the configured defaults and selected parent without a detail request", async () => {
    mount(type);
    expect(field("Name").value).toBe(initialName);
    expect(screen.getByRole("heading").textContent).toBe(`Add ${label}`);
    await waitFor(() => expect(parentOptions().length).toBe(2));
    fireEvent.change(field("Name"), { target: { value: "New Org" } });
    fireEvent.change(parentSelect(), { target: { value: "3" } });
    save();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(`Successfully added ${type}`),
    );
    expect(mocks.byId).not.toHaveBeenCalled();
    const payload = mocks.save.mock.calls[0]![0];
    expect(payload).toMatchObject({
      name: "New Org",
      parentId: 3,
      orgType: type,
      meta: null,
    });
    expect(payload.id).toBeUndefined();
    if (type === "area") expect(payload.logoUrl).toBeNull();
    else expect(payload).not.toHaveProperty("logoUrl");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("preserves untouched fields and the per-type logo payload on rename and reopen", async () => {
    const view = mount(type, 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    fireEvent.change(field("Name"), { target: { value: "Renamed Org" } });
    save();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        `Successfully updated ${type}`,
      ),
    );
    const payload = mocks.save.mock.calls[0]![0];
    const { logoUrl, ...common } = record;
    expect(payload).toEqual({
      ...common,
      name: "Renamed Org",
      orgType: type,
      ...(type === "area" ? { logoUrl } : {}),
    });
    expect(mocks.invalidate).toHaveBeenCalledWith("org");
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    mocks.byId.mockResolvedValue({ org: { ...record, ...payload } });
    mount(type, 40);
    await waitFor(() => expect(field("Name").value).toBe("Renamed Org"));
  });

  it.each(["Name", "Email"])(
    "rejects invalid %s without a mutation or toast",
    async (label) => {
      mount(type, 40);
      await waitFor(() => expect(field("Name").value).toBe(record.name));
      fireEvent.change(field(label), {
        target: { value: label === "Name" ? "" : "invalid" },
      });
      // Submit directly so browser email validation does not mask schema behavior.
      fireEvent.submit(field("Name").closest("form")!);
      await screen.findByText(
        label === "Name" ? "Name is required" : "Invalid email format",
      );
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );

  it("rejects creation without a parent selection", async () => {
    mount(type);
    fireEvent.change(field("Name"), { target: { value: "New Org" } });
    save();
    await screen.findByText("Invalid selection");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["UNAUTHORIZED", "INTERNAL_SERVER_ERROR"])(
    "retains edits after %s and permits retry with one error toast",
    async (code) => {
      mocks.save.mockRejectedValueOnce(new ORPCError(code));
      mount(type, 40);
      await waitFor(() => expect(field("Name").value).toBe(record.name));
      fireEvent.change(field("Name"), { target: { value: "Retained edit" } });
      save();
      await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
      expect(mocks.error).toHaveBeenCalledWith(
        code === "UNAUTHORIZED"
          ? `You are not authorized to update this ${type}`
          : `Failed to update ${type}`,
      );
      expect(field("Name").value).toBe("Retained edit");
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      await screen.findByRole("button", { name: "Save Changes" });
      save();
      await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
      expect(mocks.save).toHaveBeenCalledTimes(2);
      expect(mocks.error).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels unsaved edits without a mutation", async () => {
    mount(type, 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    fireEvent.change(field("Name"), { target: { value: "Discard" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("opens the existing deactivate confirmation for an active record", async () => {
    mount(type, 40);
    fireEvent.click(
      await screen.findByRole("button", { name: `Deactivate ${label}` }),
    );
    expect(mocks.open).toHaveBeenCalledWith(
      ModalType.ADMIN_DELETE_CONFIRMATION,
      { id: 40, type: deletion, orgType: type },
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([undefined, 40])(
    "omits deactivate for new or inactive records (%s)",
    async (id) => {
      mocks.byId.mockResolvedValue({ org: { ...record, isActive: false } });
      mount(type, id);
      if (id)
        await waitFor(() => expect(field("Name").value).toBe(record.name));
      expect(
        screen.queryByRole("button", { name: `Deactivate ${label}` }),
      ).toBeNull();
    },
  );
});

describe("Area parent selection", () => {
  const sectorsAndTerritories = [
    { id: 2, name: "Zulu Sector", orgType: "sector", isActive: true },
    { id: 3, name: "Alpha Sector", orgType: "sector", isActive: true },
    { id: 12, name: "Beta Territory", orgType: "territory", isActive: true },
    { id: 11, name: "Alpha Territory", orgType: "territory", isActive: true },
  ];
  const areaUnder = (parentId: number) =>
    mocks.byId.mockResolvedValue({ org: { ...record, parentId } });
  const savedParent = async () => {
    save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    return mocks.save.mock.calls[0]![0].parentId;
  };

  beforeEach(() => {
    mocks.all.mockResolvedValue({ orgs: sectorsAndTerritories });
  });

  it("labels the selector for both types and groups sectors above territories, each sorted by name", async () => {
    mount("area");

    await waitFor(() => expect(parentSelect().options.length).toBe(6));
    expect(screen.getByText("Sector or Territory")).toBeTruthy();
    expect(mocks.all).toHaveBeenCalledWith({
      orgTypes: ["sector", "territory"],
      pageIndex: 0,
      pageSize: 100,
    });
    expect(
      Array.from(parentSelect().options).map((option) => [
        option.disabled ? "group" : "org",
        option.text,
      ]),
    ).toEqual([
      ["group", "Sectors"],
      ["org", "Alpha Sector"],
      ["org", "Zulu Sector"],
      ["group", "Territories"],
      ["org", "Alpha Territory"],
      ["org", "Beta Territory"],
    ]);
  });

  it("omits a group with no organizations", async () => {
    mocks.all.mockResolvedValue({
      orgs: sectorsAndTerritories.filter((org) => org.orgType === "sector"),
    });
    mount("area");

    await waitFor(() => expect(parentSelect().options.length).toBe(3));
    expect(
      Array.from(parentSelect().options).map((option) => option.text),
    ).toEqual(["Sectors", "Alpha Sector", "Zulu Sector"]);
  });

  it("keeps an area under a sector editable and saves the same parent", async () => {
    areaUnder(2);
    mount("area", record.id);

    await waitFor(() => expect(field("Name").value).toBe(record.name));
    await waitFor(() => expect(parentSelect().value).toBe("2"));

    expect(await savedParent()).toBe(2);
  });

  it("selects the territory of an area under a territory and moves it to a sector", async () => {
    areaUnder(12);
    mount("area", record.id);

    await waitFor(() => expect(parentSelect().value).toBe("12"));
    fireEvent.change(parentSelect(), { target: { value: "3" } });

    expect(await savedParent()).toBe(3);
  });

  it("moves an area under a sector to a territory", async () => {
    areaUnder(2);
    mount("area", record.id);

    await waitFor(() => expect(parentSelect().value).toBe("2"));
    fireEvent.change(parentSelect(), { target: { value: "11" } });

    expect(await savedParent()).toBe(11);
  });

  it("keeps single-parent editors as a flat, ungrouped list", async () => {
    mocks.all.mockResolvedValue({
      orgs: sectorsAndTerritories.filter((org) => org.orgType === "sector"),
    });
    mount("territory");

    await waitFor(() => expect(parentSelect().options.length).toBe(2));
    expect(
      Array.from(parentSelect().options).every((option) => !option.disabled),
    ).toBe(true);
    expect(screen.getByText("Sector")).toBeTruthy();
  });
});

describe("Region Area or Territory parent selection", () => {
  const regionParents = [
    { id: 2, name: "Zulu Area", orgType: "area", isActive: true },
    { id: 3, name: "Alpha Area", orgType: "area", isActive: true },
    { id: 12, name: "Beta Territory", orgType: "territory", isActive: true },
    { id: 11, name: "Alpha Territory", orgType: "territory", isActive: true },
  ];

  beforeEach(() => {
    mocks.all.mockResolvedValue({ orgs: regionParents, total: 4 });
  });

  it("groups sorted Areas before Territories without offering other parent types", async () => {
    mount("region");

    await waitFor(() => expect(parentSelect().options.length).toBe(6));
    expect(screen.getByText("Area or Territory")).toBeTruthy();
    expect(mocks.all).toHaveBeenCalledWith({
      orgTypes: ["area", "territory"],
      statuses: ["active", "inactive"],
      onlyMine: true,
      pageIndex: 0,
      pageSize: 100,
    });
    expect(
      Array.from(parentSelect().options).map((option) => [
        option.disabled ? "group" : "org",
        option.text,
      ]),
    ).toEqual([
      ["group", "Areas"],
      ["org", "Alpha Area"],
      ["org", "Zulu Area"],
      ["group", "Territories"],
      ["org", "Alpha Territory"],
      ["org", "Beta Territory"],
    ]);
  });

  it.each([2, 12])("saves an unchanged current parent %i", async (parentId) => {
    mocks.byId.mockResolvedValue({ org: { ...record, parentId } });
    mount("region", record.id);
    await waitFor(() => expect(parentSelect().value).toBe(String(parentId)));

    save();

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      id: record.id,
      orgType: "region",
      parentId,
      logoUrl: record.logoUrl,
      meta: record.meta,
      email: record.email,
    });
  });

  it.each(["area", "territory"])(
    "retains the inactive current %s but excludes other inactive parent choices",
    async (orgType) => {
      const current = {
        id: 20,
        name: "Inactive Current Parent",
        orgType,
        isActive: false,
      };
      mocks.all.mockResolvedValue({
        orgs: [
          ...regionParents,
          current,
          { ...current, id: 21, name: "Other Inactive Area", orgType: "area" },
          {
            ...current,
            id: 22,
            name: "Other Inactive Territory",
            orgType: "territory",
          },
        ],
        total: 7,
      });
      mocks.byId.mockResolvedValue({
        org: { ...record, parentId: current.id },
      });
      mount("region", record.id);

      await waitFor(() =>
        expect(parentSelect().value).toBe(String(current.id)),
      );
      expect(parentOptions().map((option) => option.value)).toEqual(
        expect.arrayContaining(["2", "3", "11", "12", "20"]),
      );
      expect(parentOptions()).toHaveLength(5);
      save();
      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      expect(mocks.save.mock.calls[0]![0].parentId).toBe(current.id);
    },
  );

  it("offers only active parents when creating a Region", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        ...regionParents,
        { id: 20, name: "Inactive Area", orgType: "area", isActive: false },
        {
          id: 21,
          name: "Inactive Territory",
          orgType: "territory",
          isActive: false,
        },
      ],
      total: 6,
    });
    mount("region");

    await waitFor(() => expect(parentOptions()).toHaveLength(4));
    expect(
      parentOptions()
        .map((option) => option.value)
        .sort(),
    ).toEqual(["11", "12", "2", "3"]);
  });

  it.each([2, 12])(
    "creates beneath parent %i with the existing two-save flow",
    async (parentId) => {
      mocks.save.mockImplementation(async (input) => ({
        org: { ...input, id: 55 },
      }));
      mount("region");
      await waitFor(() => expect(parentOptions()).toHaveLength(4));
      fireEvent.change(field("Name"), { target: { value: "New Region" } });
      fireEvent.change(parentSelect(), { target: { value: String(parentId) } });

      save();

      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({
        name: "New Region",
        orgType: "region",
        parentId,
      });
      expect(mocks.save.mock.calls[1]![0]).toMatchObject({
        id: 55,
        name: "New Region",
        orgType: "region",
        parentId,
      });
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );

  it.each([
    [2, 12],
    [12, 2],
  ])(
    "moves from parent %i to %i and retains the saved parent on reopening",
    async (oldParent, newParent) => {
      mocks.byId.mockResolvedValue({ org: { ...record, parentId: oldParent } });
      const view = mount("region", record.id);
      await waitFor(() => expect(parentSelect().value).toBe(String(oldParent)));
      fireEvent.change(parentSelect(), {
        target: { value: String(newParent) },
      });
      save();

      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      const saved = mocks.save.mock.calls[0]![0];
      expect(saved).toMatchObject({
        id: record.id,
        orgType: "region",
        parentId: newParent,
        logoUrl: record.logoUrl,
        meta: record.meta,
      });
      view.unmount();
      mocks.byId.mockResolvedValue({ org: saved });
      mount("region", record.id);
      await waitFor(() => expect(parentSelect().value).toBe(String(newParent)));
    },
  );

  it("allows a non-nation-admin with source and destination access to move to an editable parent", async () => {
    mocks.all.mockResolvedValue({ orgs: [regionParents[2]], total: 1 });
    mocks.parentById.mockResolvedValue({ org: regionParents[0] });
    mount("region", record.id);
    await waitFor(() => expect(parentSelect().value).toBe("2"));
    await waitFor(() => expect(parentSelect().disabled).toBe(false));
    expect(mocks.canEditRegions).toHaveBeenCalledWith({ orgIds: [record.id] });
    expect(mocks.parentById).toHaveBeenCalledWith({ id: 2 });
    expect(parentOptions().map((option) => option.value)).toEqual(["2", "12"]);

    fireEvent.change(parentSelect(), { target: { value: "12" } });
    save();

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0].parentId).toBe(12);
  });

  it.each(["area", "territory"])(
    "preserves an inaccessible inactive current %s for an ordinary unchanged-parent save",
    async (orgType) => {
      const current = {
        id: 20,
        name: "Inactive Current Parent",
        orgType,
        isActive: false,
      };
      mocks.byId.mockResolvedValue({
        org: { ...record, parentId: current.id },
      });
      mocks.parentById.mockResolvedValue({ org: current });
      mocks.all.mockResolvedValue({ orgs: [], total: 0 });
      mount("region", record.id);
      await waitFor(() => expect(parentSelect().value).toBe("20"));
      expect(parentSelect().disabled).toBe(true);
      expect(parentOptions().map((option) => option.value)).toEqual(["20"]);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", {
            name: "Save Changes",
          }).disabled,
        ).toBe(false),
      );
      fireEvent.change(field("Name"), { target: { value: "Renamed Region" } });
      save();

      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({
        name: "Renamed Region",
        parentId: current.id,
      });
    },
  );

  it("does not permit a move with destination access alone", async () => {
    mocks.canEditRegions.mockResolvedValue({ results: [{ success: false }] });
    mount("region", record.id);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(parentSelect().disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
        .disabled,
    ).toBe(true);
    fireEvent.change(parentSelect(), { target: { value: "12" } });
    expect(
      screen.queryByRole("button", { name: "Keep current parent" }),
    ).toBeNull();
    fireEvent.submit(field("Name").closest("form")!);

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "You are not authorized to update this region",
      ),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])(
    "permits an ordinary unchanged-parent save while source access is %s",
    async (state) => {
      if (state === "pending") {
        mocks.canEditRegions.mockImplementation(
          () => new Promise(() => undefined),
        );
      } else {
        mocks.canEditRegions.mockRejectedValue(
          new Error("Permission unavailable"),
        );
      }
      mount("region", record.id);
      await waitFor(() => expect(field("Name").value).toBe(record.name));
      if (state === "failed") {
        await screen.findByText(
          "Unable to verify Region access. You can save other changes with the current parent; parent changes are unavailable.",
        );
      }
      expect(parentSelect().disabled).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(false);
      fireEvent.change(field("Name"), { target: { value: "Renamed Region" } });
      save();

      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({
        id: record.id,
        name: "Renamed Region",
        parentId: record.parentId,
      });
    },
  );

  it.each(["pending", "failed"])(
    "rejects an injected parent change while source access is %s",
    async (state) => {
      if (state === "pending") {
        mocks.canEditRegions.mockImplementation(
          () => new Promise(() => undefined),
        );
      } else {
        mocks.canEditRegions.mockRejectedValue(
          new Error("Permission unavailable"),
        );
      }
      mount("region", record.id);
      await waitFor(() => expect(parentSelect().value).toBe("2"));
      expect(parentSelect().disabled).toBe(true);
      fireEvent.change(parentSelect(), { target: { value: "12" } });
      fireEvent.submit(field("Name").closest("form")!);

      await waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith(
          "Region access must be verified before changing the parent",
        ),
      );
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "failed", "missing"])(
    "does not submit an edit as creation when the Region record is %s",
    async (state) => {
      if (state === "pending") {
        mocks.byId.mockImplementation(() => new Promise(() => undefined));
      } else if (state === "failed") {
        mocks.byId.mockRejectedValue(new Error("Region unavailable"));
      } else {
        mocks.byId.mockResolvedValue({ org: null });
      }
      mount("region", record.id);
      const message =
        state === "pending"
          ? "Loading Region details. Wait before saving."
          : state === "failed"
            ? "Unable to load this Region. Try again before saving."
            : "This Region could not be found. Reload before saving.";
      await screen.findByText(message);
      await waitFor(() => expect(parentOptions()).toHaveLength(4));
      expect(screen.getByRole("heading").textContent).toBe("Edit Region");
      expect(parentSelect().disabled).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(true);
      fireEvent.change(field("Name"), {
        target: { value: "Attempted create" },
      });
      fireEvent.change(parentSelect(), { target: { value: "12" } });
      expect(
        screen.queryByRole("button", { name: "Keep current parent" }),
      ).toBeNull();
      fireEvent.submit(field("Name").closest("form")!);

      await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(message));
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );

  it("locks the parent picker when only the current active editable parent is available and still saves ordinary changes", async () => {
    mocks.all.mockResolvedValue({ orgs: [regionParents[0]], total: 1 });
    mount("region", record.id);
    await screen.findByText(
      "No other editable Area or Territory is available. The current parent is retained, and you can save other Region details.",
    );
    expect(parentSelect().disabled).toBe(true);
    expect(parentSelect().value).toBe("2");
    fireEvent.change(field("Name"), { target: { value: "Renamed Region" } });
    save();

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      id: record.id,
      name: "Renamed Region",
      parentId: record.parentId,
    });
  });

  it("keeps an unchanged-parent save available when destination access cannot be loaded", async () => {
    mocks.parentById.mockResolvedValue({ org: regionParents[0] });
    mocks.all.mockRejectedValue(new Error("Parent options unavailable"));
    mount("region", record.id);
    await screen.findByText(
      "Unable to load editable parent choices. Try again before changing the parent.",
    );
    expect(parentSelect().disabled).toBe(true);
    expect(parentSelect().value).toBe("2");
    save();

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0].parentId).toBe(2);
  });

  it.each(["edit", "create"])(
    "rejects a stale chosen destination after a failed parent-choice refetch (%s)",
    async (mode) => {
      mount("region", mode === "edit" ? record.id : undefined);
      await waitFor(() => expect(parentSelect().disabled).toBe(false));
      if (mode === "create") {
        fireEvent.change(field("Name"), { target: { value: "New Region" } });
      }
      fireEvent.change(parentSelect(), { target: { value: "12" } });
      mocks.all.mockRejectedValue(new Error("Parent options unavailable"));
      await act(async () => {
        await clients.at(-1)!.invalidateQueries({ queryKey: [["org", "all"]] });
      });
      await screen.findByText(
        "Unable to load editable parent choices. Try again before changing the parent.",
      );
      expect(parentSelect().value).toBe("12");
      expect(parentSelect().disabled).toBe(true);
      if (mode === "create") {
        expect(
          screen.queryByRole("button", { name: "Keep current parent" }),
        ).toBeNull();
      }
      save();

      await waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith(
          "Unable to load editable parent choices. Try again before changing the parent.",
        ),
      );
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it.each(["parent choices", "source access"])(
    "restores the current parent without losing detail edits after a failed %s refetch",
    async (lookup) => {
      mount("region", record.id);
      await waitFor(() => expect(parentSelect().disabled).toBe(false));
      expect(
        screen.queryByRole("button", { name: "Keep current parent" }),
      ).toBeNull();
      fireEvent.change(field("Name"), { target: { value: "Renamed Region" } });
      fireEvent.change(field("Website"), {
        target: { value: "https://renamed.example.com" },
      });
      fireEvent.change(parentSelect(), { target: { value: "12" } });

      if (lookup === "parent choices") {
        mocks.all.mockRejectedValue(new Error("Parent options unavailable"));
      } else {
        mocks.canEditRegions.mockRejectedValue(
          new Error("Permission unavailable"),
        );
      }
      await act(async () => {
        await clients.at(-1)!.invalidateQueries({
          queryKey:
            lookup === "parent choices"
              ? [["org", "all"]]
              : ["request", "canEditRegions"],
        });
      });
      const message =
        lookup === "parent choices"
          ? "Unable to load editable parent choices. Try again before changing the parent."
          : "Unable to verify Region access. You can save other changes with the current parent; parent changes are unavailable.";
      await screen.findByText(message);
      expect(parentSelect().value).toBe("12");
      expect(parentSelect().disabled).toBe(true);
      save();
      await waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith(
          lookup === "parent choices"
            ? message
            : "Region access must be verified before changing the parent",
        ),
      );
      expect(mocks.save).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: "Keep current parent" }),
      );
      expect(parentSelect().value).toBe(String(record.parentId));
      expect(parentSelect().disabled).toBe(true);
      expect(field("Name").value).toBe("Renamed Region");
      expect(field("Website").value).toBe("https://renamed.example.com");
      expect(
        screen.queryByRole("button", { name: "Keep current parent" }),
      ).toBeNull();
      expect(mocks.save).not.toHaveBeenCalled();
      save();

      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({
        ...record,
        orgType: "region",
        name: "Renamed Region",
        website: "https://renamed.example.com",
      });
    },
  );

  it("rejects a parent outside the editable destination choices before submitting", async () => {
    mocks.all.mockResolvedValue({ orgs: [regionParents[2]], total: 1 });
    mocks.parentById.mockResolvedValue({ org: regionParents[0] });
    mount("region", record.id);
    await waitFor(() => expect(parentSelect().disabled).toBe(false));
    // Simulate a value injected past the disabled/filtered select boundary.
    const unavailable = document.createElement("option");
    unavailable.value = "99";
    parentSelect().append(unavailable);
    fireEvent.change(parentSelect(), { target: { value: "99" } });
    save();

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "You need editor or admin access to the selected Area or Territory",
      ),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("Nation exceptions", () => {
  it("omits parent, logo and deactivation while retaining common values", async () => {
    mount("nation", 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(mocks.all).not.toHaveBeenCalled();
    expect(screen.queryByText("Logo")).toBeNull();
    expect(screen.queryByText("Deactivate Nation")).toBeNull();
    save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const { parentId: _parent, logoUrl: _logo, ...common } = record;
    expect(mocks.save.mock.calls[0]![0]).toEqual({
      ...common,
      parentId: undefined,
      orgType: "nation",
    });
  });
  it("retains the distinct mutation and submit error feedback and permits retry", async () => {
    mocks.save.mockRejectedValueOnce(new ORPCError("UNAUTHORIZED"));
    mount("nation", 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    save();
    await waitFor(() =>
      expect(mocks.error.mock.calls).toEqual([
        ["You are not authorized to update this nation"],
        ["Failed to update nation"],
      ]),
    );
    expect(field("Name").value).toBe(record.name);
    save();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Successfully updated nation"),
    );
  });
});

describe.each(["nation", "region", "ao"] as const)(
  "%s additional validation",
  (type) => {
    it("shows field errors and the existing validation toast without saving", async () => {
      mount(type);
      save();
      await screen.findByText("Name is required");
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        `Failed to update ${type}`,
      );
      expect(mocks.save).not.toHaveBeenCalled();
    });
  },
);

describe.each(["region", "ao"] as const)("%s logo editor", (type) => {
  const label = type === "region" ? "Region" : "AO";
  const originalURL = URL;
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  beforeEach(() => {
    mocks.all.mockResolvedValue({
      orgs: parents.map((parent) => ({
        ...parent,
        orgType: type === "region" ? "area" : "region",
      })),
    });
    mocks.upload.mockResolvedValue("https://example.com/new-logo.png");
    class TestURL extends originalURL {
      static createObjectURL = vi.fn(() => "blob:preview");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
  });
  it("preserves URL construction and restores the original global methods", () => {
    expect(new URL("/logo.png", "https://example.com").href).toBe(
      "https://example.com/logo.png",
    );
    expect(URL.createObjectURL(new Blob())).toBe("blob:preview");
    vi.unstubAllGlobals();
    expect(URL).toBe(originalURL);
    expect(Object.getOwnPropertyDescriptor(URL, "createObjectURL")).toEqual(
      originalCreateObjectURL,
    );
    expect(Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")).toEqual(
      originalRevokeObjectURL,
    );
  });
  it("preserves contact fields, metadata and stored logo on rename", async () => {
    mount(type, 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(screen.getByAltText(`${label} Logo`).getAttribute("src")).toBe(
      record.logoUrl,
    );
    fireEvent.change(field("Name"), { target: { value: "New name" } });
    save();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        `Successfully updated ${type}`,
      ),
    );
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      ...record,
      name: "New name",
      badImage: false,
      orgType: type,
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "creates then updates with upload=%s",
    async (withFile) => {
      const events: string[] = [];
      mocks.save.mockImplementation(async (input) => {
        events.push(input.id ? "update" : "create");
        return { org: { ...record, id: 60 } };
      });
      mocks.upload.mockImplementation(async () => {
        events.push("upload");
        return "https://example.com/new-logo.png";
      });
      const view = mount(type);
      fireEvent.change(field("Name"), { target: { value: "New org" } });
      await waitFor(() => expect(parentOptions()).toHaveLength(2));
      fireEvent.change(parentSelect(), { target: { value: "3" } });
      const file = new File(["synthetic"], "logo.png", { type: "image/png" });
      if (withFile)
        fireEvent.change(view.container.querySelector('input[type="file"]')!, {
          target: { files: [file] },
        });
      save();
      await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
      expect(events).toEqual(
        withFile ? ["create", "upload", "update"] : ["create", "update"],
      );
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({
        name: "New org",
        parentId: 3,
        orgType: type,
        logoUrl: null,
        badImage: false,
      });
      expect(mocks.save.mock.calls[1]![0]).toMatchObject({
        id: 60,
        logoUrl: withFile ? "https://example.com/new-logo.png" : null,
      });
      if (withFile)
        expect(mocks.upload).toHaveBeenCalledWith({ file, orgId: 60 });
      expect(mocks.success).toHaveBeenCalledWith(
        `Successfully ${type === "ao" ? "updated" : "added"} ${type}`,
      );
    },
  );
  it("retains edits and stops before update after an upload failure", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("Upload failed"));
    const view = mount(type, 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["synthetic"], "logo.png")] },
    });
    save();
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        type === "ao" ? "Upload failed" : "Failed to update region",
      ),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(field("Name").value).toBe(record.name);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
  });
  it("retains image preview feedback in the form payload", async () => {
    mount(type, 40);
    const image = await screen.findByAltText(`${label} Logo`);
    fireEvent.error(image);
    save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0].badImage).toBe(true);
  });
});

it.each([null, undefined])(
  "saves a Region location description when loaded metadata is %s",
  async (meta) => {
    mocks.byId.mockResolvedValue({ org: { ...record, meta } });
    mount("region", 40);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    fireEvent.change(field("Short Location Description"), {
      target: { value: "Synthetic City" },
    });
    save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      id: 40,
      orgType: "region",
      meta: { region_location_short_description: "Synthetic City" },
      badImage: false,
    });
  },
);

it("changes Region location description without losing other metadata", async () => {
  mocks.byId.mockResolvedValue({
    org: {
      ...record,
      meta: { ...record.meta, website: "https://example.com/keep" },
    },
  });
  mount("region", 40);
  await waitFor(() => expect(field("Name").value).toBe(record.name));
  fireEvent.change(field("Short Location Description"), {
    target: { value: "Synthetic City" },
  });
  save();
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]![0].meta).toEqual({
    region_location_short_description: "Synthetic City",
    website: "https://example.com/keep",
  });
});

it("keeps the AO fake-data action restricted to development", async () => {
  const view = mount("ao", undefined, true);
  expect(screen.queryByText("(DEV) Fake data")).toBeNull();
  view.unmount();
  mount("ao", undefined, false);
  fireEvent.click(screen.getByText("(DEV) Fake data"));
  expect(field("Name").value).toBe("Fake AO");
  expect(field("Website").value).toBe("https://fakeao.com");
  expect(field("Email").value).toBe("fakeao@example.com");
  expect(field("Twitter").value).toBe("@fakeao");
  expect(field("Facebook").value).toBe("https://facebook.com/fakeao");
  expect(field("Instagram").value).toBe("https://instagram.com/fakeao");
  expect(field("Description").value).toBe("Fake AO description");
});

describe("Territory organization integration", () => {
  it("hides Add when Territory creation is disabled in configuration", async () => {
    const original = orgAdminConfig.territory.add;
    try {
      orgAdminConfig.territory.add = false;
      const page = await OrgPage({
        params: Promise.resolve({ orgSegment: "territories" }),
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      clients.push(client);
      render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
      expect(screen.getByRole("heading", { name: "Territories" })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Add Territory" }),
      ).toBeNull();
    } finally {
      orgAdminConfig.territory.add = original;
    }
  });

  function EditorHost() {
    const modal = useOpenModal();
    if (modal?.type !== ModalType.ADMIN_ORG) return null;
    const data = modal.data as ModalStore.DataType[ModalType.ADMIN_ORG];
    return <AdminOrgEditModal {...data} isProd={false} />;
  }
  it("uses the real route, navigation, table, add/edit and successful API flow", async () => {
    const actualStore = await vi.importActual<typeof ModalStore>(
      "~/utils/store/modal",
    );
    // Keep modal-close timeouts owned by this test while async queries settle.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    onTestFinished(async () => {
      try {
        vi.setTimerTickMode("manual");
        actualStore.closeModal(undefined, "all");
        await vi.runOnlyPendingTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });
    actualStore.closeModal(undefined, "all");
    mocks.open.mockImplementation(actualStore.openModal);
    mocks.close.mockImplementation(actualStore.closeModal);
    mocks.all.mockImplementation(async (input) => {
      const query = input as { orgTypes: string[] };
      return {
        orgs: query.orgTypes.includes("territory")
          ? [{ ...record, orgType: "territory", created: "2026-01-01" }]
          : parents,
        total: 1,
      };
    });
    mocks.byId.mockResolvedValue({ org: { ...record, orgType: "territory" } });
    const page = await OrgPage({
      params: Promise.resolve({ orgSegment: "territories" }),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <AdminNavLinks mapUrl="https://example.com/map" />
        {page}
        <EditorHost />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Territories" }).getAttribute("href"),
    ).toBe("/territories");
    expect(screen.getByRole("heading", { name: "Territories" })).toBeTruthy();
    fireEvent.click(await screen.findByText(record.name));
    await screen.findByRole("heading", { name: "Edit Territory" });
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(mocks.byId).toHaveBeenCalledWith({ id: 40, orgType: "territory" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Territory" }));
    await screen.findByRole("heading", { name: "Add Territory" });
    const parent = screen.getByRole("dialog").querySelector("select")!;
    await waitFor(() => expect(parent.options.length).toBe(2));
    const statusSelect = () =>
      Array.from(screen.getByRole("dialog").querySelectorAll("select")).find(
        (select) =>
          Array.from(select.options).some(
            (option) => option.text === "Inactive",
          ),
      )!;
    fireEvent.change(statusSelect(), { target: { value: "false" } });
    expect(statusSelect().value).toBe("false");
    expect(screen.queryByText("(DEV) Fake data")).toBeNull();
    expect(field("Name").value).toBe("");
    fireEvent.change(field("Name"), { target: { value: "Test Territory" } });
    fireEvent.change(field("Twitter"), { target: { value: "@testterritory" } });
    // Invalid input is rejected through the real shared form validator.
    save();
    await screen.findByText(
      "Please enter a valid X/Twitter URL (e.g. https://x.com/f3nation)",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    // Replace the rejected handle with a valid URL, then submit again.
    fireEvent.change(field("Twitter"), {
      target: { value: "https://x.com/testterritory" },
    });
    fireEvent.change(screen.getByRole("dialog").querySelector("select")!, {
      target: { value: "3" },
    });
    save();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Successfully added territory",
      ),
    );
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      orgType: "territory",
      name: "Test Territory",
      parentId: 3,
      twitter: "https://x.com/testterritory",
      isActive: false,
    });
    expect(mocks.all).toHaveBeenCalledWith(
      expect.objectContaining({ orgTypes: ["territory"] }),
    );
    expect(mocks.all).toHaveBeenCalledWith({
      orgTypes: ["sector"],
      pageIndex: 0,
      pageSize: 100,
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Heaviest test in the suite (full render + navigation + validation
    // round-trip + save); the default 5s timeout flakes under parallel CI load.
  }, 15_000);

  it.each(["unknown-org", "arbitrary-path", "constructor", "__proto__"])(
    "rejects %s before issuing organization queries",
    async (orgSegment) => {
      await expect(
        OrgPage({ params: Promise.resolve({ orgSegment }) }),
      ).rejects.toThrow("NOT_FOUND");
      expect(mocks.all).not.toHaveBeenCalled();
      expect(mocks.byId).not.toHaveBeenCalled();
    },
  );
});

it("retains AO loaded schema fields beyond the visible controls", async () => {
  mocks.byId.mockResolvedValue({
    org: {
      ...record,
      created: "2026-01-01T12:00:00Z",
      updated: "2026-02-01T12:00:00Z",
    },
  });
  mount("ao", 40);
  await waitFor(() => expect(field("Name").value).toBe(record.name));
  save();
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({
    created: "2026-01-01T12:00:00Z",
    updated: "2026-02-01T12:00:00Z",
  });
});
