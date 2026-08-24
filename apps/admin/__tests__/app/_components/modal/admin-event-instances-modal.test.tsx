/**
 * Covers the logic that lives inside `AdminEventInstancesModal` rather than in
 * an extracted helper: the cross-field form validation, the reset-on-load
 * effect that converts stored `HHmm` times into the `HH:mm` the inputs expect,
 * and the submit flow that trims and nulls optional fields before calling
 * `crupdate`.
 *
 * A flipped inequality in the date/time comparisons, or a broken `length === 5`
 * guard that stops times from being compared at all, would otherwise ship with
 * nothing failing.
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
// not do. These tests drive the form through the instance payload instead, so a
// stub that renders nothing is enough.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: () => null,
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
    if (options.queryKey.includes("org.all")) {
      return { data: { orgs: [] }, isLoading: false };
    }
    if (options.queryKey.includes("location.all")) {
      return { data: { locations: [] }, isLoading: false };
    }
    if (options.queryKey.includes("eventType.all")) {
      return { data: { eventTypes: [] }, isLoading: false };
    }
    if (options.queryKey.includes("event.all")) {
      return { data: { events: [] }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutateAsync: crupdateMutateAsync }),
  orpc: {
    org: { all: { queryOptions: () => ({ queryKey: ["org.all"] }) } },
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
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const submittedPayload = () =>
      crupdateMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;

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
