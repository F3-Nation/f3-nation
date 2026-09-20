import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPositionsModal from "~/app/_components/modal/admin-positions-modal";
import type * as ModalStore from "~/utils/store/modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
  save: vi.fn<(input: unknown) => Promise<unknown>>(),
  isNationAdmin: false,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("~/utils/hooks/use-auth", () => ({
  useAuth: () => ({ isNationAdmin: mocks.isNationAdmin }),
}));
vi.mock("~/utils/store/modal", async (original) => ({
  ...(await original<typeof ModalStore>()),
  closeModal: vi.fn(),
  openModal: vi.fn(),
}));
vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@acme/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
// Exercise the real form state through native controls without popover layout.
vi.mock("@acme/ui/select", async () => {
  const { useController } = await import("react-hook-form");
  return {
    ControlledSelect: ({
      control,
      name,
      label,
      options,
    }: {
      control: Control<{ orgType: string }>;
      name: "orgType";
      label: string;
      options: { value: string; label: string }[];
    }) => {
      const { field } = useController({ control, name });
      return (
        <select
          aria-label={label}
          value={field.value ?? ""}
          onChange={field.onChange}
        >
          <option value="">Choose</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    },
  };
});
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    onSelect,
  }: {
    value?: string;
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select
      aria-label="Organization"
      value={value ?? ""}
      onChange={(event) => onSelect(event.target.value)}
    >
      <option value="">Choose</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: vi.fn(),
  orpc: {
    position: {
      byId: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled: boolean;
        }) => ({
          queryKey: ["position", input],
          queryFn: () => mocks.byId(input),
          enabled,
        }),
      },
      crupdate: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.save,
        }),
      },
    },
  },
}));

// The org dropdown needs every editable org, so admin-positions-modal.tsx
// pages through org.all via useFetchAllPages, calling the imperative
// client directly rather than going through orpc.org.all's queryOptions --
// route it to the same mocks.all so existing mocks.all.mockResolvedValue
// setups still apply.
vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

const clients: QueryClient[] = [];
function mount(id?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AdminPositionsModal data={{ id }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNationAdmin = false;
  mocks.byId.mockResolvedValue({ position: null });
  mocks.all.mockResolvedValue({
    orgs: [{ id: 42, name: "Example Territory" }],
  });
  mocks.save.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("Territory positions", () => {
  it("selects Territory and submits its organization and type", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Territory Q" },
    });
    fireEvent.change(screen.getByLabelText("Org Level"), {
      target: { value: "territory" },
    });
    await screen.findByRole("option", { name: "Example Territory" });
    expect(mocks.all).toHaveBeenCalledWith(
      expect.objectContaining({ orgTypes: ["territory"] }),
    );
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Territory Q",
          orgType: "territory",
          orgId: 42,
        }),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("option", { name: "Nation" })).toBeNull();
  });

  it("loads an existing Territory position with its type selected", async () => {
    mocks.byId.mockResolvedValue({
      position: {
        id: 7,
        name: "Territory Q",
        orgType: "territory",
        orgId: 42,
        orgName: "Example Territory",
        isActive: true,
      },
    });
    mount(7);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>("Org Level").value).toBe(
        "territory",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>("Organization").value,
      ).toBe("42"),
    );
  });

  it("retains the Nation option for nation administrators", () => {
    mocks.isNationAdmin = true;
    mount();
    expect(screen.getByRole("option", { name: "Nation" })).toBeTruthy();
  });
});
