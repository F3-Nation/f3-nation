import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminWorkoutsModal from "~/app/_components/modal/admin-workouts-modal";
import type * as ModalStore from "~/utils/store/modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
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
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: vi.fn(),
  orpc: {
    event: {
      byId: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled: boolean;
        }) => ({
          queryKey: ["event", input],
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
  client: {
    org: { all: () => Promise.resolve({ orgs: [], total: 0 }) },
    location: { all: () => Promise.resolve({ locations: [], totalCount: 0 }) },
    eventType: {
      all: () => Promise.resolve({ eventTypes: [], totalCount: 0 }),
    },
  },
}));

const clients: QueryClient[] = [];
function mount(id: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AdminWorkoutsModal data={{ id }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("AdminWorkoutsModal", () => {
  // React deduplicates this warning, so check it before other event loads.
  it("keeps the disabled ID controlled after the event loads", async () => {
    let resolveEvent!: (value: unknown) => void;
    const eventLookup = new Promise((resolve) => {
      resolveEvent = resolve;
    });
    mocks.byId.mockReturnValue(eventLookup);
    const consoleError = vi.spyOn(console, "error");

    try {
      mount(12);
      await act(async () => {
        resolveEvent({
          event: {
            id: 12,
            name: "The Grind",
            locationId: null,
            email: null,
            startTime: "0530",
            endTime: "0615",
            startDate: "2026-01-05",
            endDate: null,
            dayOfWeek: "monday",
            isActive: true,
            highlight: false,
            regions: [{ regionId: 5 }],
            aos: [{ aoId: 8 }],
            eventTypes: [{ eventTypeId: 3 }],
            meta: null,
          },
        });
        await eventLookup;
      });

      const id = await screen.findByPlaceholderText<HTMLInputElement>("ID");
      await waitFor(() => expect(id.value).toBe("12"));
      expect(id.disabled).toBe(true);
      expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
        /uncontrolled input to be controlled|controlled input to be uncontrolled/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
