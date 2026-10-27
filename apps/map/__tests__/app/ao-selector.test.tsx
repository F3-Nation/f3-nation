import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RegionAndAOSelector } from "~/app/_components/forms/form-inputs/region-and-ao-selector";

const { getAOsInRegion, getRegions } = vi.hoisted(() => ({
  getAOsInRegion: vi.fn(),
  getRegions: vi.fn(),
}));

// Keep the real oRPC query options, TanStack Query and form subscriptions.
vi.mock("~/orpc/client", () => ({
  client: {
    map: { location: { getAOsInRegion } },
    org: { all: getRegions },
  },
}));

// Replace only the virtualized UI; clearing uses its real [] callback value.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    options,
    value,
    onSelect,
    searchPlaceholder,
  }: {
    options: { label: string; value: string }[];
    value?: string;
    onSelect: (value: string | string[]) => void;
    searchPlaceholder: string;
  }) => (
    <select
      aria-label={searchPlaceholder}
      value={value ?? ""}
      onChange={(event) => onSelect(event.target.value || [])}
    >
      <option value="">{searchPlaceholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

type RegionField = "originalRegionId" | "newRegionId";

function SelectorForm({
  regionField,
  initialRegion,
}: {
  regionField: RegionField;
  initialRegion: null | undefined;
}) {
  const form = useForm<{
    originalRegionId?: number | null;
    newRegionId?: number | null;
    originalAoId?: number | null;
    newAoId?: number | null;
  }>({
    defaultValues: {
      originalRegionId: initialRegion,
      newRegionId: initialRegion,
      originalAoId: null,
      newAoId: null,
    },
  });

  return (
    <FormProvider {...form}>
      <RegionAndAOSelector
        regionFieldName={regionField}
        aoFieldName={
          regionField === "originalRegionId" ? "originalAoId" : "newAoId"
        }
      />
    </FormProvider>
  );
}

// TanStack Query notifies observers on a setTimeout(0), which async act does
// not wait for. Running it as a microtask lets `act` settle each fetch, so the
// assertions below never race a findBy* timeout on a slow, cold CI worker.
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler((cb) => setTimeout(cb, 0)));

describe.each<RegionField>(["originalRegionId", "newRegionId"])(
  "AO selector using %s",
  (regionField) => {
    beforeEach(() => {
      vi.clearAllMocks();
      getRegions.mockResolvedValue({
        orgs: [{ id: 42, name: "Test Region" }],
        total: 1,
      });
      getAOsInRegion.mockResolvedValue({
        aos: [{ id: 123, name: "Test AO", workouts: [] }],
      });
    });

    it.each([null, undefined])(
      "fetches only for a selected region, starting with %s",
      async (initialRegion) => {
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });
        const { unmount } = render(
          <QueryClientProvider client={queryClient}>
            <SelectorForm
              regionField={regionField}
              initialRegion={initialRegion}
            />
          </QueryClientProvider>,
        );
        await act(() => Promise.resolve());

        expect(
          screen.getByRole("option", { name: "Test Region" }),
        ).toBeInTheDocument();
        expect(getAOsInRegion).not.toHaveBeenCalled();

        await act(async () => {
          fireEvent.change(
            screen.getByRole("combobox", { name: "Select Region" }),
            { target: { value: "42" } },
          );
        });
        expect(
          screen.getByRole("option", { name: "Test AO" }),
        ).toBeInTheDocument();
        expect(getAOsInRegion).toHaveBeenCalledExactlyOnceWith(
          { regionId: 42 },
          expect.anything(),
        );

        await act(async () => {
          fireEvent.change(
            screen.getByRole("combobox", { name: "Select Region" }),
            { target: { value: "" } },
          );
        });

        expect(screen.queryByRole("option", { name: "Test AO" })).toBeNull();
        expect(getAOsInRegion).toHaveBeenCalledTimes(1);

        unmount();
        queryClient.clear();
      },
    );
  },
);
