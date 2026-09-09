import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";

import AdminOrgEditModal from "~/app/_components/modal/admin-org-edit-modal";
import OrgPage from "~/app/[orgSegment]/page";
import { AdminNavLinks } from "~/app/_components/admin-nav-links";
import { useOpenModal } from "~/utils/store/modal";
import { DeleteType, ModalType } from "~/utils/store/modal";
import type * as ModalStore from "~/utils/store/modal";
import type * as SharedEnums from "@acme/shared/app/enums";
import type * as OrgHierarchy from "@acme/shared/app/org-hierarchy";
import type * as EditorConfig from "~/app/_components/modal/org-editor-config";
import type * as AdminConfig from "~/app/_components/org/org-admin-config";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
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
vi.mock("@acme/shared/app/enums", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedEnums>();
  return { ...actual, OrgType: [...actual.OrgType, "territory"] };
});
vi.mock("@acme/shared/app/org-hierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof OrgHierarchy>();
  return {
    ...actual,
    orgTypeDisplay: {
      ...actual.orgTypeDisplay,
      territory: {
        label: "Territory",
        pluralLabel: "Territories",
        routeSegment: "territories",
        icon: "Earth",
      },
    },
  };
});
vi.mock("~/app/_components/modal/org-editor-config", async (importOriginal) => {
  const actual = await importOriginal<typeof EditorConfig>();
  return {
    ...actual,
    orgEditorConfig: {
      ...actual.orgEditorConfig,
      territory: {
        parentType: "sector",
        parentPlaceholder: "Select a sector",
        defaultName: "",
        retainLogo: false,
        deactivate: "existing",
        devFakeData: true,
      },
    },
  };
});
vi.mock("~/app/_components/org/org-admin-config", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminConfig>();
  return {
    ...actual,
    orgAdminConfig: {
      ...actual.orgAdminConfig,
      territory: {
        add: true,
        serverPagination: true,
        serverSorting: true,
        filters: "status",
        columns: [],
        statusId: "status",
        aoCount: true,
      },
    },
  };
});
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
          queryFn: () => mocks.byId(input),
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
  },
}));

// Popover layout/focus are browser concerns. Native selects exercise the same
// controlled value, option ordering and onValueChange contract in jsdom.
vi.mock("@acme/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  { id: 2, name: "Zulu" },
  { id: 3, name: "Alpha" },
];
const clients: QueryClient[] = [];

function mount(
  type: "nation" | "sector" | "area" | "region" | "ao",
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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.byId.mockResolvedValue({ org: record });
  mocks.all.mockResolvedValue({ orgs: parents });
  mocks.save.mockResolvedValue({ org: record });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe.each([
  {
    type: "sector" as const,
    label: "Sector",
    parent: "nation",
    initialName: "Unknown",
    deletion: DeleteType.ORG,
  },
  {
    type: "area" as const,
    label: "Area",
    parent: "sector",
    initialName: "",
    deletion: DeleteType.ORG,
  },
])("$label editor", ({ type, label, parent, initialName, deletion }) => {
  it("loads the record and sorted parent options with the current selection", async () => {
    mount(type, record.id);
    await waitFor(() => expect(field("Name").value).toBe(record.name));
    expect(screen.getByRole("heading").textContent).toBe(`Edit ${label}`);
    expect(field("ID").disabled).toBe(true);
    expect(field("ID").value).toBe("40");
    await waitFor(() => expect(parentSelect().options.length).toBe(2));
    expect(
      Array.from(parentSelect().options).map((option) => option.text),
    ).toEqual(["Alpha", "Zulu"]);
    expect(parentSelect().value).toBe("2");
    expect(mocks.byId).toHaveBeenCalledWith({ id: 40, orgType: type });
    expect(mocks.all).toHaveBeenCalledWith({ orgTypes: [parent] });
  });

  it("creates with the configured defaults and selected parent without a detail request", async () => {
    mount(type);
    expect(field("Name").value).toBe(initialName);
    expect(screen.getByRole("heading").textContent).toBe(`Add ${label}`);
    await waitFor(() => expect(parentSelect().options.length).toBe(2));
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
  beforeEach(() => {
    mocks.all.mockResolvedValue({
      orgs: parents.map((parent) => ({
        ...parent,
        orgType: type === "region" ? "area" : "region",
      })),
    });
    mocks.upload.mockResolvedValue("https://example.com/new-logo.png");
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:preview"),
        revokeObjectURL: vi.fn(),
      }),
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
      await waitFor(() => expect(parentSelect().options.length).toBe(2));
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

describe("configuration-only sixth organization type", () => {
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
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    fireEvent.click(screen.getByText("(DEV) Fake data"));
    random.mockRestore();
    expect(screen.getByRole("dialog").querySelector("select")!.value).toBe("2");
    expect(field("Last Annual Review").value).toBe("2024-01-01");
    expect(statusSelect().value).toBe("true");
    expect(field("Name").value).toBe("Fake Territory");
    expect(field("Twitter").value).toBe("@faketerritory");
    // Preserve the existing AO fixture's handle format. The real validator
    // requires a URL, so verify feedback and correct it before saving.
    save();
    await screen.findByText(
      "Please enter a valid X/Twitter URL (e.g. https://x.com/f3nation)",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(field("Twitter"), {
      target: { value: "https://x.com/faketerritory" },
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
      name: "Fake Territory",
      parentId: 3,
      website: "https://faketerritory.com",
      email: "faketerritory@example.com",
      twitter: "https://x.com/faketerritory",
      facebook: "https://facebook.com/faketerritory",
      instagram: "https://instagram.com/faketerritory",
      description: "Fake Territory description",
    });
    expect(mocks.all).toHaveBeenCalledWith(
      expect.objectContaining({ orgTypes: ["territory"] }),
    );
    expect(mocks.all).toHaveBeenCalledWith({ orgTypes: ["sector"] });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    actualStore.closeModal(undefined, "all");
  });

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
