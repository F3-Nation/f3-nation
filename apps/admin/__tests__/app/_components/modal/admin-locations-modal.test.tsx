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

import AdminLocationsModal from "~/app/_components/modal/admin-locations-modal";
import type * as ModalStore from "~/utils/store/modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
  save: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
vi.mock("~/app/_components/map/google-map-simple", () => ({
  GoogleMapSimple: () => null,
}));
// Replace only the virtualized UI; clearing uses its real [] callback value.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    onSelect,
    searchPlaceholder,
  }: {
    value?: string;
    options: { value: string; label: string }[];
    onSelect: (value: string | string[]) => void;
    searchPlaceholder: string;
  }) => (
    <select
      aria-label={searchPlaceholder}
      value={value ?? ""}
      onChange={(event) => onSelect(event.target.value || [])}
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
    location: {
      byId: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled: boolean;
        }) => ({
          queryKey: ["location", input],
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
vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

const clients: QueryClient[] = [];
function mount(id: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AdminLocationsModal data={{ id }} googleApiKey="" isProd={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.byId.mockResolvedValue({
    location: {
      id: 9,
      locationName: "The Park",
      regionId: 5,
      latitude: 35,
      longitude: -80,
      addressCountry: "US",
      isActive: true,
    },
  });
  mocks.all.mockResolvedValue({
    orgs: [{ id: 5, name: "Example Region" }],
    total: 1,
  });
  mocks.save.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("AdminLocationsModal", () => {
  it("saves a cleared country as an empty string, not []", async () => {
    mount(9);
    // The FormItem is keyed by value, so re-query after the reset remounts it.
    const country = () =>
      screen.getByLabelText<HTMLSelectElement>("Select a country");
    await waitFor(() => expect(country().value).toBe("US"));

    fireEvent.change(country(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9, addressCountry: "" }),
        expect.anything(),
      ),
    );
  });
});
