/**
 * Covers the logic that lives inside `AdminEventInstancesModal` rather than in
 * an extracted helper: the cross-field form validation, the reset-on-load
 * effect that converts stored `HHmm` times into the `HH:mm` the inputs expect,
 * the submit flow that trims and nulls optional fields before calling
 * `crupdate`, and the combobox `onSelect` handlers that keep region, AO,
 * location, series and event types in step as the admin picks them.
 *
 * A flipped inequality in the date/time comparisons, or a broken `length === 5`
 * guard that stops times from being compared at all, would otherwise ship with
 * nothing failing. So would a cross-field handler that leaves the form holding
 * a location in a region the instance no longer belongs to — the exact shape of
 * "move this workout to a different AO for one day".
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ModalStore from "~/utils/store/modal";
import AdminEventInstancesModal, {
  EventInstanceFormSchema,
  seriesExceptionOptions,
} from "~/app/_components/modal/admin-event-instances-modal";

const { toastMock, crupdateMutateAsync, instanceState } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  crupdateMutateAsync: vi.fn(),
  instanceState: { current: null as Record<string, unknown> | null },
}));

/**
 * The reference data the comboboxes offer. Two regions, each with its own AOs
 * and locations, is the minimum that can tell "kept the current location"
 * apart from "reset it to one in the new region".
 */
const REGIONS = [
  { id: 3, name: "Metro" },
  { id: 4, name: "Lakes" },
];
const AOS = [
  { id: 42, name: "Alpha AO", parentId: 3 },
  { id: 43, name: "Charlie AO", parentId: 3 },
  { id: 55, name: "Bravo AO", parentId: 4 },
];
const LOCATIONS = [
  { id: 11, regionId: 3, locationName: "The Park" },
  { id: 12, regionId: 3, locationName: "The Track" },
  { id: 21, regionId: 4, locationName: "Lakeside" },
  { id: 22, regionId: 4, locationName: "Boat Ramp" },
];
const EVENT_TYPES = [
  { id: 2, name: "Bootcamp", eventCategory: null },
  { id: 5, name: "Ruck", eventCategory: null },
];
const SERIES = [
  { id: 200, name: "Monday Bootcamp", highlight: true },
  { id: 201, name: "Saturday Ruck", highlight: false },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@acme/ui/toast", () => ({ toast: toastMock }));

// Keep the real ModalType/DeleteType enums the component reads as values;
// only the two navigation side effects are stubbed.
vi.mock("~/utils/store/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof ModalStore>()),
  closeModal: vi.fn(),
  openModal: vi.fn(),
}));

// The real combobox virtualizes a popover list, which needs layout jsdom does
// not do. Rendering nothing would also stub out every `onSelect` handler in the
// modal, so this keeps the part of the contract the modal depends on: one
// clickable button per option, a clear button, and `onSelect` called with the
// shape the real component sends — a bare string for single-select, the toggled
// array for multi, an empty array on clear (see `handleSelect` and `onClear` in
// `packages/ui/src/virtualized-combobox.tsx`).
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    searchPlaceholder,
    onSelect,
    isMulti,
    disabled,
  }: {
    value?: string | string[];
    options: { value: string; label: string }[];
    searchPlaceholder?: string;
    onSelect?: (items: string | string[]) => void;
    isMulti?: boolean;
    disabled?: boolean;
  }) => {
    // Derived from the prop rather than held in state, mirroring the effect
    // that resyncs the real component's selection whenever `value` changes.
    const selected = typeof value === "string" ? [value] : (value ?? []);
    return (
      <div data-testid={`combobox-${searchPlaceholder ?? ""}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            data-option={option.value}
            data-testid={`option-${searchPlaceholder}-${option.value}`}
            onClick={() =>
              onSelect?.(
                isMulti
                  ? selected.includes(option.value)
                    ? selected.filter((entry) => entry !== option.value)
                    : [...selected, option.value]
                  : option.value,
              )
            }
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          data-testid={`clear-${searchPlaceholder}`}
          onClick={() => onSelect?.([])}
        >
          clear
        </button>
      </div>
    );
  },
}));

vi.mock("~/orpc/react", () => ({
  ORPCError: class ORPCError extends Error {
    code: string;
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? code);
      this.code = code;
    }
  },
  invalidateQueries: vi.fn(),
  useQuery: (options: { queryKey: string[] }) => {
    if (options.queryKey.includes("eventInstance.byId")) {
      return { data: instanceState.current, isLoading: false };
    }
    // The modal runs `org.all` twice — once for regions, once for AOs — so the
    // key has to carry the requested orgType or both calls see one list.
    if (options.queryKey.includes("org.all")) {
      return {
        data: {
          orgs: options.queryKey.includes("region") ? REGIONS : AOS,
        },
        isLoading: false,
      };
    }
    if (options.queryKey.includes("location.all")) {
      return { data: { locations: LOCATIONS }, isLoading: false };
    }
    if (options.queryKey.includes("eventType.all")) {
      return { data: { eventTypes: EVENT_TYPES }, isLoading: false };
    }
    if (options.queryKey.includes("event.all")) {
      return { data: { events: SERIES }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutateAsync: crupdateMutateAsync }),
  orpc: {
    org: {
      all: {
        queryOptions: (options: { input: { orgTypes?: string[] } }) => ({
          queryKey: ["org.all", ...(options.input.orgTypes ?? [])],
        }),
      },
    },
    location: {
      all: { queryOptions: () => ({ queryKey: ["location.all"] }) },
    },
    eventType: {
      all: { queryOptions: () => ({ queryKey: ["eventType.all"] }) },
    },
    event: { all: { queryOptions: () => ({ queryKey: ["event.all"] }) } },
    eventInstance: {
      byId: { queryOptions: () => ({ queryKey: ["eventInstance.byId"] }) },
      crupdate: {
        mutationOptions: () => ({ mutationKey: ["eventInstance.crupdate"] }),
      },
    },
  },
}));

const baseInstance = {
  id: 7,
  orgId: 42,
  org: { parentId: 3 },
  locationId: 11,
  startDate: "2026-09-01",
  endDate: null,
  name: "Morning Ruck",
  description: "Bring a sandbag",
  startTime: "0530",
  endTime: "0615",
  eventTypes: [{ eventTypeId: 2 }],
  seriesId: null,
  seriesException: null,
  isPrivate: false,
  highlight: false,
  isActive: true,
};

const renderEditing = (overrides: Record<string, unknown> = {}) => {
  instanceState.current = { ...baseInstance, ...overrides };
  return render(<AdminEventInstancesModal data={{ id: 7 }} />);
};

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

/**
 * The time inputs are queried by id rather than by label: `ControlledTimeInput`
 * drops the `id` that `FormControl` passes down and renders its own, so the
 * `FormLabel`'s `for` points at an element that does not exist and the input
 * has no accessible name. Pre-existing, and not what these tests are for.
 */
const timeField = (id: "startTime" | "endTime") => {
  const el = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`no #${id} input rendered`);
  return el;
};

// Each combobox is addressed by its search placeholder — the only prop that
// distinguishes them from outside the component.
const selectOption = (placeholder: string, value: string | number) =>
  fireEvent.click(screen.getByTestId(`option-${placeholder}-${value}`));

const clearSelection = (placeholder: string) =>
  fireEvent.click(screen.getByTestId(`clear-${placeholder}`));

const offeredOptions = (placeholder: string) =>
  Array.from(
    screen
      .getByTestId(`combobox-${placeholder}`)
      .querySelectorAll<HTMLButtonElement>("[data-option]"),
  ).map((button) => button.dataset.option);

const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

const submittedPayload = () =>
  crupdateMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;

const saved = async () => {
  await waitFor(() => {
    expect(crupdateMutateAsync).toHaveBeenCalledTimes(1);
  });
  return submittedPayload();
};

describe("EventInstanceFormSchema", () => {
  const valid = {
    orgId: 42,
    startDate: "2026-09-01",
    eventTypeIds: [],
    isPrivate: false,
    highlight: false,
    isActive: true,
  };

  const parse = (overrides: Record<string, unknown> = {}) =>
    EventInstanceFormSchema.safeParse({ ...valid, ...overrides });

  const messagesFor = (
    result: ReturnType<typeof parse>,
    path: string,
  ): string[] =>
    result.success
      ? []
      : result.error.issues
          .filter((issue) => issue.path[0] === path)
          .map((issue) => issue.message);

  describe("time ordering", () => {
    it("rejects an end time before the start time", () => {
      const result = parse({ startTime: "07:00", endTime: "06:00" });

      expect(result.success).toBe(false);
      expect(messagesFor(result, "endTime")).toContain(
        "End time must be after start time",
      );
    });

    it("accepts an end time after the start time", () => {
      expect(parse({ startTime: "05:30", endTime: "06:15" }).success).toBe(
        true,
      );
    });

    // The comparison is `startTime > endTime`, so an equal pair is allowed
    // through. Pinned so flipping it to `>=` is a deliberate choice.
    it("accepts an end time equal to the start time", () => {
      expect(parse({ startTime: "05:30", endTime: "05:30" }).success).toBe(
        true,
      );
    });

    // Both guards exist because a partially-typed `<input type="time">` emits
    // short strings, and "7:0" > "06:00" lexically — comparing those would
    // flag an error mid-keystroke on a range that is actually fine.
    it("skips the comparison while a time is still incomplete", () => {
      expect(parse({ startTime: "7:0", endTime: "06:00" }).success).toBe(true);
      expect(parse({ startTime: "07:00", endTime: "6:0" }).success).toBe(true);
    });

    it("skips the comparison when either time is absent", () => {
      expect(parse({ startTime: null, endTime: "06:00" }).success).toBe(true);
      expect(parse({ startTime: "07:00", endTime: null }).success).toBe(true);
      expect(parse({ startTime: "", endTime: "" }).success).toBe(true);
    });
  });

  describe("date ordering", () => {
    it("rejects an end date before the start date", () => {
      const result = parse({
        startDate: "2026-09-01",
        endDate: "2026-08-31",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result, "endDate")).toContain(
        "End date must be on or after start date",
      );
    });

    // "on or after" — the same day is a one-day instance, not an error.
    it("accepts an end date equal to the start date", () => {
      expect(
        parse({ startDate: "2026-09-01", endDate: "2026-09-01" }).success,
      ).toBe(true);
    });

    it("accepts an end date after the start date", () => {
      expect(
        parse({ startDate: "2026-09-01", endDate: "2026-09-02" }).success,
      ).toBe(true);
    });

    it("skips the comparison when the end date is absent", () => {
      expect(parse({ endDate: null }).success).toBe(true);
      expect(parse({ endDate: undefined }).success).toBe(true);
    });
  });

  describe("required fields", () => {
    // The form seeds orgId to 0 before an AO is picked, so a plain
    // `z.number()` would accept the placeholder as a real organization.
    it("rejects the unselected-organization placeholder", () => {
      const result = parse({ orgId: 0 });

      expect(result.success).toBe(false);
      expect(messagesFor(result, "orgId")).toContain("Select an organization");
    });

    it("rejects a negative orgId", () => {
      expect(parse({ orgId: -1 }).success).toBe(false);
    });

    it("accepts a real orgId", () => {
      expect(parse({ orgId: 1 }).success).toBe(true);
    });

    it("rejects an empty start date", () => {
      const result = parse({ startDate: "" });

      expect(result.success).toBe(false);
      expect(messagesFor(result, "startDate")).toContain(
        "Start date is required",
      );
    });
  });
});

describe("AdminEventInstancesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crupdateMutateAsync.mockResolvedValue({ id: 7 });
    instanceState.current = null;
  });

  describe("reset on load", () => {
    it("converts the instance's stored HHmm times into the HH:mm the inputs expect", async () => {
      renderEditing();

      await waitFor(() => {
        expect(timeField("startTime").value).toBe("05:30");
      });
      expect(timeField("endTime").value).toBe("06:15");
    });

    // A stored time that is not four characters cannot be converted, so the
    // field clears rather than rendering a half-converted value.
    it("leaves a time blank when the stored value is not HHmm", async () => {
      renderEditing({ startTime: "530", endTime: null });

      await waitFor(() => {
        expect(field("Start date").value).toBe("2026-09-01");
      });
      expect(timeField("startTime").value).toBe("");
      expect(timeField("endTime").value).toBe("");
    });

    it("seeds the remaining fields from the loaded instance", async () => {
      renderEditing();

      await waitFor(() => {
        expect(field("Start date").value).toBe("2026-09-01");
      });
      expect(field("End date (optional)").value).toBe("");
      expect(field("Name (optional)").value).toBe("Morning Ruck");
      expect(field("Description (optional)").value).toBe("Bring a sandbag");
    });

    it("titles itself for editing when an instance loads", async () => {
      renderEditing();

      await waitFor(() => {
        expect(screen.getByText("Edit Event Instance")).toBeTruthy();
      });
    });

    it("starts empty when creating", async () => {
      instanceState.current = null;
      render(<AdminEventInstancesModal data={{}} />);

      await waitFor(() => {
        expect(screen.getByText("Add Event Instance")).toBeTruthy();
      });
      expect(field("Start date").value).toBe("");
      expect(field("Name (optional)").value).toBe("");
      expect(timeField("startTime").value).toBe("");
    });
  });

  describe("submit", () => {
    it("converts the form's HH:mm times back to stored HHmm", async () => {
      renderEditing();
      await waitFor(() => {
        expect(timeField("startTime").value).toBe("05:30");
      });

      save();

      await waitFor(() => {
        expect(crupdateMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(submittedPayload()).toMatchObject({
        id: 7,
        startTime: "0530",
        endTime: "0615",
      });
    });

    it("trims the name and nulls a whitespace-only description", async () => {
      renderEditing({ name: "  Morning Ruck  ", description: "   " });
      await waitFor(() => {
        expect(field("Name (optional)").value).toBe("  Morning Ruck  ");
      });

      save();

      await waitFor(() => {
        expect(crupdateMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(submittedPayload()).toMatchObject({
        name: "Morning Ruck",
        description: null,
      });
    });

    it("sends null rather than an empty string for an absent end date", async () => {
      renderEditing({ endDate: null });
      await waitFor(() => {
        expect(field("End date (optional)").value).toBe("");
      });

      save();

      await waitFor(() => {
        expect(crupdateMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(submittedPayload()).toMatchObject({ endDate: null });
    });

    // `toStoredTime` maps a cleared field to null so the stored time is
    // actually removed rather than silently kept.
    it("clears a time that was emptied instead of keeping the old value", async () => {
      renderEditing();
      await waitFor(() => {
        expect(timeField("startTime").value).toBe("05:30");
      });

      fireEvent.change(timeField("startTime"), { target: { value: "" } });
      fireEvent.change(timeField("endTime"), { target: { value: "" } });
      save();

      await waitFor(() => {
        expect(crupdateMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(submittedPayload()).toMatchObject({
        startTime: null,
        endTime: null,
      });
    });

    // The schema and the submit path have to agree: a rejected pair must never
    // reach the mutation.
    it("blocks the mutation and shows the message when the times are out of order", async () => {
      renderEditing({ startTime: "0700", endTime: "0600" });
      await waitFor(() => {
        expect(timeField("startTime").value).toBe("07:00");
      });

      save();

      await waitFor(() => {
        expect(
          screen.getByText("End time must be after start time"),
        ).toBeTruthy();
      });
      expect(crupdateMutateAsync).not.toHaveBeenCalled();
    });

    it("blocks the mutation and shows the message when the dates are out of order", async () => {
      renderEditing({ startDate: "2026-09-01", endDate: "2026-08-31" });
      await waitFor(() => {
        expect(field("End date (optional)").value).toBe("2026-08-31");
      });

      save();

      await waitFor(() => {
        expect(
          screen.getByText("End date must be on or after start date"),
        ).toBeTruthy();
      });
      expect(crupdateMutateAsync).not.toHaveBeenCalled();
    });

    it("blocks the mutation when no organization is selected", async () => {
      renderEditing({ orgId: 0 });
      await waitFor(() => {
        expect(field("Start date").value).toBe("2026-09-01");
      });

      save();

      await waitFor(() => {
        expect(screen.getByText("Select an organization")).toBeTruthy();
      });
      expect(crupdateMutateAsync).not.toHaveBeenCalled();
    });
  });

  /**
   * The comboboxes are not independent: picking one can rewrite the others, and
   * those rewrites are the mechanics of relocating a single occurrence. The
   * baseline instance is Alpha AO (region 3) at location 11 (region 3).
   */
  describe("cross-field selection", () => {
    const loaded = () =>
      waitFor(() => {
        expect(field("Start date").value).toBe("2026-09-01");
      });

    /**
     * Both lists are filtered to the form's region, which is what makes the AO
     * and location handlers' "adopt the selected row's region, then reset a
     * location that region cannot host" branches unreachable from the UI: every
     * offered AO already has `parentId === regionId`, and every offered location
     * already has `regionId === regionId`. Moving regions is the separate step
     * below, and it clears the location before an AO is ever picked.
     */
    it("offers only the current region's AOs, and an AO switch keeps the location", async () => {
      renderEditing();
      await loaded();

      // Region 4's Bravo AO (55) is deliberately absent.
      expect(offeredOptions("Select an AO")).toEqual(["42", "43"]);

      selectOption("Select an AO", 43);
      save();

      expect(await saved()).toMatchObject({ orgId: 43, locationId: 11 });
    });

    it("offers only the current region's locations", async () => {
      renderEditing();
      await loaded();

      // Region 4's Lakeside (21) and Boat Ramp (22) are absent; the rest are
      // sorted by name — The Park (11), then The Track (12).
      expect(offeredOptions("Select a location")).toEqual(["11", "12"]);

      selectOption("Select a location", 12);
      save();

      expect(await saved()).toMatchObject({ locationId: 12 });
    });

    it("clears the location without disturbing the region", async () => {
      renderEditing();
      await loaded();

      clearSelection("Select a location");
      save();

      expect(await saved()).toMatchObject({ locationId: null });
      expect(offeredOptions("Select an AO")).toEqual(["42", "43"]);
    });

    it("resets the AO, location, event types and series when the region changes", async () => {
      renderEditing({ seriesId: 200 });
      await loaded();

      selectOption("Select a region", 4);
      save();

      // orgId falls back to the 0 placeholder, so the form has to refuse rather
      // than send the old AO alongside the new region.
      await waitFor(() => {
        expect(screen.getByText("Select an organization")).toBeTruthy();
      });
      expect(crupdateMutateAsync).not.toHaveBeenCalled();

      selectOption("Select an AO", 55);
      save();

      expect(await saved()).toMatchObject({
        orgId: 55,
        locationId: null,
        eventTypeIds: [],
        seriesId: null,
      });
    });

    it("takes highlight from a selected series, overwriting the instance's own", async () => {
      renderEditing({ highlight: false });
      await loaded();

      selectOption("Select a series", 200);
      save();

      expect(await saved()).toMatchObject({ seriesId: 200, highlight: true });
    });

    it("takes highlight false from a series that is not highlighted", async () => {
      renderEditing({ highlight: true });
      await loaded();

      selectOption("Select a series", 201);
      save();

      expect(await saved()).toMatchObject({ seriesId: 201, highlight: false });
    });

    it("leaves highlight alone when the series is cleared", async () => {
      renderEditing({ seriesId: 200, highlight: true });
      await loaded();

      clearSelection("Select a series");
      save();

      expect(await saved()).toMatchObject({ seriesId: null, highlight: true });
    });

    it("adds a toggled-on event type to the ids it submits", async () => {
      renderEditing();
      await loaded();

      selectOption("Select event types", 5);
      save();

      expect(await saved()).toMatchObject({ eventTypeIds: [2, 5] });
    });

    it("removes an event type that is toggled off", async () => {
      renderEditing();
      await loaded();

      selectOption("Select event types", 2);
      save();

      expect(await saved()).toMatchObject({ eventTypeIds: [] });
    });

    it("cannot pick event types before a region is chosen", async () => {
      instanceState.current = null;
      render(<AdminEventInstancesModal data={{}} />);

      await waitFor(() => {
        expect(screen.getByText("Add Event Instance")).toBeTruthy();
      });
      // Event types are region-scoped, so the field stays disabled until the
      // region query has something to scope to.
      expect(
        screen.getByTestId<HTMLButtonElement>("option-Select a region first-2")
          .disabled,
      ).toBe(true);
    });
  });
});

describe("seriesExceptionOptions", () => {
  it("offers only the selectable exceptions", () => {
    expect(seriesExceptionOptions(null)).toEqual(["closed", "different-time"]);
    expect(seriesExceptionOptions(undefined)).toEqual([
      "closed",
      "different-time",
    ]);
    expect(seriesExceptionOptions("closed")).toEqual([
      "closed",
      "different-time",
    ]);
  });

  it("keeps a stored value that is no longer offered", () => {
    // Without this the Select has no matching item, so an existing
    // `miscellaneous` row would render as the "None" placeholder and get
    // cleared by any unrelated save.
    expect(seriesExceptionOptions("miscellaneous")).toEqual([
      "closed",
      "different-time",
      "miscellaneous",
    ]);
  });
});
