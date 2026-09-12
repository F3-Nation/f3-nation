/**
 * `WorkoutDetailsContent` resolves the selected event from three async sources
 * (the location's own events, the upcoming-instance list, and the
 * parent-series fallback). The panel must only warn about a broken link once
 * every source that could still supply an event has settled — and it must
 * warn, rather than render a near-empty panel, when none of them does.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RouterOutputs } from "~/orpc/types";

type UpcomingInstance =
  RouterOutputs["map"]["location"]["upcomingInstances"][number];
type LocationWorkout = RouterOutputs["map"]["location"]["locationWorkout"];
type EventById = RouterOutputs["event"]["byId"];
interface QueryState {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
}

const { queryStates, enabledCalls } = vi.hoisted(() => ({
  queryStates: new Map<string, QueryState>(),
  enabledCalls: [] as { key: string; enabled?: boolean }[],
}));

// One fake query per oRPC procedure the panel calls, keyed by the tag its
// `queryOptions` stub returns. `enabled: false` mirrors react-query: a disabled
// query never produces data.
vi.mock("~/orpc/react", () => {
  const queryOptions =
    (key: string) =>
    (options: { enabled?: boolean } = {}) => ({ key, ...options });
  return {
    useQuery: ({ key, enabled }: { key: string; enabled?: boolean }) => {
      enabledCalls.push({ key, enabled });
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        ...(enabled === false ? {} : queryStates.get(key)),
      };
    },
    useMutation: vi.fn(),
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    orpc: {
      map: {
        location: {
          locationWorkout: { queryOptions: queryOptions("locationWorkout") },
          upcomingInstances: {
            queryOptions: queryOptions("upcomingInstances"),
          },
        },
      },
      event: { byId: { queryOptions: queryOptions("eventById") } },
    },
  };
});

// The chips and the URL sync are exercised elsewhere; stubbing them keeps this
// suite on the event-resolution branches.
vi.mock("~/app/_components/map/event-chip", () => ({
  EventChip: ({ event }: { event: { id: number; name?: string } }) => (
    <div data-testid={`chip-${event.id}`}>{event.name}</div>
  ),
}));
vi.mock("~/utils/hooks/use-update-event-search-params", () => ({
  useUpdateEventSearchParams: vi.fn(),
}));
// The exception-list hook reports failures to Sentry; the report itself is
// covered in `__tests__/utils/hooks/use-upcoming-instances.test.ts`.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import {
  createWorkoutEventFromInstance,
  WorkoutDetailsContent,
} from "~/app/_components/workout/workout-details-content";

const locationEvent = (
  overrides: Partial<
    NonNullable<LocationWorkout["location"]>["events"][number]
  > = {},
) => ({
  id: 1,
  name: "Monday Bootcamp",
  description: null,
  dayOfWeek: "monday" as const,
  startTime: "0530",
  endTime: "0615",
  startDate: null,
  endDate: null,
  eventTypes: [{ id: 1, name: "Bootcamp" }],
  aoId: 5,
  aoLogo: null,
  aoWebsite: null,
  aoName: "Alpha AO",
  ...overrides,
});

const locationWorkout = (
  events: NonNullable<LocationWorkout["location"]>["events"],
): LocationWorkout => ({
  location: {
    id: 10,
    name: "The Park",
    description: null,
    lat: 35.5,
    lon: -80.5,
    orgId: 5,
    locationName: "The Park",
    locationMeta: null,
    locationAddress: "123 Main St",
    locationAddress2: null,
    locationCity: "Charlotte",
    locationState: "NC",
    locationZip: null,
    locationCountry: "US",
    isActive: true,
    created: "2026-01-01",
    updated: "2026-01-01",
    locationDescription: null,
    parentId: 5,
    parentLogo: null,
    parentName: "Alpha AO",
    parentWebsite: null,
    parentEmail: null,
    parentPhone: null,
    parentTwitter: null,
    parentFacebook: null,
    parentInstagram: null,
    regionId: 2,
    regionName: "Metro",
    regionLogo: null,
    regionWebsite: null,
    regionEmail: null,
    regionPhone: null,
    regionTwitter: null,
    regionFacebook: null,
    regionInstagram: null,
    regionType: "region",
    fullAddress: "123 Main St, Charlotte, NC",
    events,
  },
  message: undefined,
});

const renderPanel = (providedEventId: number | null) =>
  render(
    <WorkoutDetailsContent
      locationId={10}
      providedEventId={providedEventId}
      chipSize="small"
    />,
  );

const warning = () => screen.queryByText("Event is unavailable.");

const wasEverEnabled = (key: string) =>
  enabledCalls.some((call) => call.key === key && call.enabled !== false);

describe("WorkoutDetailsContent event resolution", () => {
  beforeEach(() => {
    queryStates.clear();
    enabledCalls.length = 0;
    // The location always resolves with at least one event — the API returns
    // `location: null` when it has none, so the panel can never see an empty
    // events array alongside a non-null location.
    queryStates.set("locationWorkout", {
      data: locationWorkout([locationEvent()]),
    });
  });

  it("renders the workout when the provided id is one of the location's events", () => {
    renderPanel(1);

    expect(warning()).toBeNull();
    expect(screen.getByTestId("chip-1")).toBeTruthy();
    expect(screen.getByText("Bootcamp")).toBeTruthy();
    expect(screen.getByText("Copy Link to Event")).toBeTruthy();
  });

  // The fallback is a multi-join lookup behind an authenticated endpoint. It
  // must stay dormant for the overwhelmingly common case, where the location
  // query already carries the selected event.
  it("skips the parent-series fallback when the location already supplies the event", () => {
    queryStates.set("upcomingInstances", { data: [] });

    renderPanel(1);

    expect(wasEverEnabled("eventById")).toBe(false);
    expect(warning()).toBeNull();
  });

  it("enables the parent-series fallback for an id the location does not carry", () => {
    queryStates.set("upcomingInstances", { data: [] });

    renderPanel(999);

    expect(wasEverEnabled("eventById")).toBe(true);
  });

  it("skips the parent-series fallback for an instance the location list already covers", () => {
    const instance = {
      id: 5,
      seriesId: 7,
      locationId: 10,
      startDate: "2026-05-18",
      startTime: "0530",
      endTime: "0615",
      seriesException: null,
      highlight: false,
      name: "Monday Bootcamp",
      lat: 35.5,
      lon: -80.5,
      aoName: "Alpha AO",
      aoLogo: null,
      locationAddress: "123 Main St",
      locationAddress2: null,
      locationCity: "Charlotte",
      locationState: "NC",
      locationCountry: "US",
      fullAddress: "123 Main St, Charlotte, NC",
      eventTypes: [{ id: 1, name: "Bootcamp" }],
    } satisfies UpcomingInstance;
    queryStates.set("upcomingInstances", { data: [instance] });

    // The series is not among the location's events, so the instance is
    // synthesized into the chip list under its own negative id — no fallback
    // fetch is needed to render it.
    renderPanel(-5);

    expect(wasEverEnabled("eventById")).toBe(false);
    expect(warning()).toBeNull();
  });

  it("warns when the provided id resolves to no event anywhere", () => {
    queryStates.set("upcomingInstances", { data: [] });
    const noSuchEvent: EventById = { event: null };
    queryStates.set("eventById", { data: noSuchEvent });

    renderPanel(999);

    expect(warning()).toBeTruthy();
  });

  it("warns when the parent-series fallback query fails", () => {
    queryStates.set("upcomingInstances", { data: [] });
    queryStates.set("eventById", { isError: true });

    renderPanel(999);

    expect(warning()).toBeTruthy();
  });

  it("holds off warning while the parent-series fallback is still in flight", () => {
    queryStates.set("upcomingInstances", { data: [] });

    renderPanel(999);

    expect(warning()).toBeNull();
  });

  it("holds off warning while the instance list backing a negative id loads", () => {
    renderPanel(-5);

    expect(warning()).toBeNull();
  });

  it("warns when a negative id is absent from the loaded instance list", () => {
    queryStates.set("upcomingInstances", { data: [] });

    renderPanel(-5);

    expect(warning()).toBeTruthy();
  });

  // A failed exception list must not read as "nothing has changed here" — the
  // panel's "upcoming changes" callout is absent either way.
  it("says so in the panel when the schedule-change list is unavailable", () => {
    queryStates.set("upcomingInstances", { isError: true });

    renderPanel(1);

    expect(
      screen.getByText("Some schedule changes may not be showing"),
    ).toBeTruthy();
  });

  it("shows no such notice once the schedule-change list loads", () => {
    queryStates.set("upcomingInstances", { data: [] });

    renderPanel(1);

    expect(
      screen.queryByText("Some schedule changes may not be showing"),
    ).toBeNull();
  });

  it("warns when the instance list fails and a negative id has nowhere else to resolve", () => {
    queryStates.set("upcomingInstances", { isError: true });

    renderPanel(-5);

    expect(warning()).toBeTruthy();
  });
});

describe("createWorkoutEventFromInstance", () => {
  it("maps an upcoming instance into a selectable workout-details event", () => {
    const instance: UpcomingInstance = {
      id: 42,
      seriesId: null,
      locationId: 10,
      startDate: "2026-05-16",
      startTime: "0630",
      endTime: "0730",
      seriesException: null,
      highlight: true,
      name: "Roving Saturday Beatdown",
      lat: 35.5,
      lon: -80.5,
      aoName: "Alpha AO",
      aoLogo: "alpha.png",
      locationAddress: "123 Main St",
      locationAddress2: null,
      locationCity: "Charlotte",
      locationState: "NC",
      locationCountry: "US",
      fullAddress: "123 Main St, Charlotte, NC",
      eventTypes: [{ id: 1, name: "Bootcamp" }],
    };

    expect(createWorkoutEventFromInstance(instance)).toEqual(
      expect.objectContaining({
        id: -42,
        name: "Roving Saturday Beatdown",
        dayOfWeek: "saturday",
        startTime: "0630",
        endTime: "0730",
        aoName: "Alpha AO",
        aoLogo: "alpha.png",
        eventTypes: [{ id: 1, name: "Bootcamp" }],
      }),
    );
  });
});
