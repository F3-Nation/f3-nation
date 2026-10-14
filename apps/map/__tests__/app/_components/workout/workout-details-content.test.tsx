/**
 * `WorkoutDetailsContent` resolves the selected event from three async sources
 * (the location's own events, the upcoming-instance list, and the
 * parent-series fallback). The panel must only warn about a broken link once
 * every source that could still supply an event has settled — and it must
 * warn, rather than render a near-empty panel, when none of them does.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RouterOutputs } from "~/orpc/types";
import * as modal from "~/utils/store/modal";

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
// The exception-list hook reports failures to PostHog; the report itself is
// covered in `__tests__/utils/hooks/use-upcoming-instances.test.ts`.
vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));

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

type InstanceOrgs = NonNullable<
  LocationWorkout["location"]
>["instanceOrgs"][number];

const locationWorkout = (
  events: NonNullable<LocationWorkout["location"]>["events"],
  instanceOrgs: InstanceOrgs[] = [],
  orgs: Partial<Omit<InstanceOrgs, "instanceId">> = {},
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
    ...orgs,
    instanceOrgs,
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
    // Most locations carry a series event. An empty events array alongside a
    // non-null location means the location's only workouts are upcoming
    // instances; that case has its own describe block below.
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

describe("WorkoutDetailsContent with one-off workouts", () => {
  // A one-off workout: no series, so the API returns the location with no
  // events and the panel synthesizes the event from the instance list.
  const oneOff = {
    id: 5,
    seriesId: null,
    locationId: 10,
    startDate: "2026-05-17",
    startTime: "0001",
    endTime: "0100",
    seriesException: null,
    highlight: false,
    name: "Third F Gathering",
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
    eventTypes: [{ id: 3, name: "3rd F" }],
  } satisfies UpcomingInstance;

  beforeEach(() => {
    queryStates.clear();
    enabledCalls.length = 0;
    queryStates.set("locationWorkout", { data: locationWorkout([]) });
  });

  it("renders the instance when the sidebar chip supplies its negative id", () => {
    queryStates.set("upcomingInstances", { data: [oneOff] });

    renderPanel(-5);

    expect(warning()).toBeNull();
    expect(screen.getByTestId("chip--5")).toBeTruthy();
    expect(screen.getByText("Copy Link to Event")).toBeTruthy();
  });

  // A map pin click opens the panel with no event id; the default selection
  // can't come from the (empty) series list.
  it("selects the instance by default when no event id is provided", () => {
    queryStates.set("upcomingInstances", { data: [oneOff] });

    renderPanel(null);

    expect(warning()).toBeNull();
    expect(screen.getByText("Copy Link to Event")).toBeTruthy();
  });

  it("holds off warning while the instance list backing the default selection loads", () => {
    renderPanel(null);

    expect(warning()).toBeNull();
  });

  // Instances at one location can come from different orgs. The location-level
  // org fields only describe the soonest, so the panel must take the selected
  // instance's AO and region from its own `instanceOrgs` entry.
  describe("with workouts from different orgs", () => {
    const orgsFor = (
      instanceId: number,
      ao: string,
      region: string,
    ): InstanceOrgs => ({
      instanceId,
      parentId: instanceId * 100,
      parentLogo: null,
      parentName: ao,
      parentWebsite: `https://${ao.toLowerCase().replace(/ /g, "-")}.example`,
      parentEmail: null,
      parentPhone: null,
      parentTwitter: null,
      parentFacebook: null,
      parentInstagram: null,
      regionId: instanceId * 1000,
      regionName: region,
      regionLogo: null,
      regionWebsite: null,
      regionEmail: null,
      regionPhone: null,
      regionTwitter: null,
      regionFacebook: null,
      regionInstagram: null,
      regionType: "region",
    });
    const laterOneOff = {
      ...oneOff,
      id: 6,
      startDate: "2026-05-20",
      name: "Bravo Convergence",
      aoName: "Bravo AO",
    } satisfies UpcomingInstance;

    beforeEach(() => {
      queryStates.set("locationWorkout", {
        data: locationWorkout(
          [],
          [orgsFor(5, "Alpha AO", "Metro"), orgsFor(6, "Bravo AO", "Uptown")],
        ),
      });
      queryStates.set("upcomingInstances", { data: [oneOff, laterOneOff] });
    });

    const regionHeading = (region: string) =>
      screen.queryByText(`About F3 ${region}`);
    const aoContactLink = (ao: string) =>
      document.querySelector(
        `a[href^="https://${ao.toLowerCase().replace(/ /g, "-")}.example"]`,
      );

    it("shows the later workout's own AO and region when it is selected", () => {
      renderPanel(-6);

      expect(screen.getByAltText("Logo for Bravo AO")).toBeTruthy();
      expect(regionHeading("Uptown")).toBeTruthy();
      expect(regionHeading("Metro")).toBeNull();
      expect(aoContactLink("Bravo AO")).toBeTruthy();
      expect(aoContactLink("Alpha AO")).toBeNull();
    });

    it("follows the selection when switching between the workouts' chips", () => {
      const { rerender } = renderPanel(-5);
      expect(screen.getByAltText("Logo for Alpha AO")).toBeTruthy();
      expect(regionHeading("Metro")).toBeTruthy();

      rerender(
        <WorkoutDetailsContent
          locationId={10}
          providedEventId={-6}
          chipSize="small"
        />,
      );
      expect(screen.getByAltText("Logo for Bravo AO")).toBeTruthy();
      expect(regionHeading("Uptown")).toBeTruthy();
      expect(aoContactLink("Bravo AO")).toBeTruthy();

      rerender(
        <WorkoutDetailsContent
          locationId={10}
          providedEventId={-5}
          chipSize="small"
        />,
      );
      expect(screen.getByAltText("Logo for Alpha AO")).toBeTruthy();
      expect(regionHeading("Metro")).toBeTruthy();
      expect(aoContactLink("Alpha AO")).toBeTruthy();
    });

    // The instance list arrives unordered; the default must still be the
    // soonest, matching the API's location-level fallback.
    it("defaults to the soonest workout regardless of list order", () => {
      queryStates.set("upcomingInstances", { data: [laterOneOff, oneOff] });

      renderPanel(null);

      expect(screen.getByAltText("Logo for Alpha AO")).toBeTruthy();
      expect(regionHeading("Metro")).toBeTruthy();
    });

    // Same day: the earlier start time wins even when it has the higher id,
    // so an id-only tie-break would pick the wrong workout.
    it("defaults to the earlier start time on the same day", () => {
      const later = { ...oneOff, id: 5, startTime: "0600" };
      const earlier = {
        ...laterOneOff,
        startDate: oneOff.startDate,
        startTime: "0500",
      };
      queryStates.set("upcomingInstances", { data: [later, earlier] });

      renderPanel(null);

      expect(screen.getByAltText("Logo for Bravo AO")).toBeTruthy();
      expect(regionHeading("Uptown")).toBeTruthy();
    });

    // Postgres ASC puts a null startTime last, like the API's ordering.
    it("ranks a workout with no start time last on the same day", () => {
      const untimed = { ...oneOff, id: 5, startTime: null };
      const timed = {
        ...laterOneOff,
        startDate: oneOff.startDate,
        startTime: "2300",
      };
      queryStates.set("upcomingInstances", { data: [untimed, timed] });

      renderPanel(null);

      expect(screen.getByAltText("Logo for Bravo AO")).toBeTruthy();
      expect(regionHeading("Uptown")).toBeTruthy();
    });

    // The cached instance list can be newer than locationWorkout. Showing no
    // AO or region beats showing another workout's contact links.
    it("shows no AO or region when the selected workout has no orgs entry", () => {
      queryStates.set("locationWorkout", {
        data: locationWorkout([], [orgsFor(5, "Alpha AO", "Metro")]),
      });

      renderPanel(-6);

      expect(screen.getAllByText("Bravo Convergence").length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByAltText("Logo for Alpha AO")).toBeNull();
      expect(aoContactLink("Alpha AO")).toBeNull();
      expect(regionHeading("Metro")).toBeNull();
    });

    describe("at a location that also has a recurring workout", () => {
      const recurringOrgs = {
        ...orgsFor(1, "Alpha AO", "Metro"),
        parentName: "Alpha AO",
        regionName: "Metro",
        parentLogo: "https://alpha-ao.example/logo.png",
        parentEmail: "alpha@ao.example",
        regionLogo: "https://metro.example/logo.png",
        regionWebsite: "https://metro.example",
        regionEmail: "metro@region.example",
      };
      const oneOffOrgs = {
        ...orgsFor(6, "Bravo AO", "Uptown"),
        parentName: "Bravo AO",
        regionName: "Uptown",
        parentLogo: "https://bravo-ao.example/logo.png",
        parentEmail: "bravo@ao.example",
        regionLogo: "https://uptown.example/logo.png",
        regionWebsite: "https://uptown.example",
        regionEmail: "uptown@region.example",
      };
      const { instanceId: _recurringInstanceId, ...recurringLocationOrgs } =
        recurringOrgs;

      beforeEach(() => {
        queryStates.set("locationWorkout", {
          data: locationWorkout(
            [locationEvent()],
            [{ ...oneOffOrgs, instanceId: 5 }, oneOffOrgs],
            recurringLocationOrgs,
          ),
        });
      });

      const expectOrgs = (
        selected: typeof recurringOrgs,
        other: typeof recurringOrgs,
      ) => {
        expect(
          screen
            .getByAltText(`Logo for ${selected.parentName}`)
            .getAttribute("src"),
        ).toBe(selected.parentLogo);
        expect(
          screen.getByAltText(selected.regionName).getAttribute("src"),
        ).toBe(selected.regionLogo);
        expect(regionHeading(selected.regionName)).toBeTruthy();
        expect(regionHeading(other.regionName)).toBeNull();
        for (const orgs of [selected, other]) {
          for (const href of [
            orgs.parentWebsite,
            orgs.regionWebsite,
            `mailto:${orgs.parentEmail}`,
            `mailto:${orgs.regionEmail}`,
          ]) {
            const link = document.querySelector(`a[href="${href}"]`);
            if (orgs === selected) expect(link).toBeTruthy();
            else expect(link).toBeNull();
          }
        }
      };

      it("uses the recurring workout's orgs for the default selection", () => {
        renderPanel(null);

        expectOrgs(recurringOrgs, oneOffOrgs);
      });

      it("switches AO, region, logos and contacts with the selected workout", () => {
        const { rerender } = renderPanel(-6);

        expectOrgs(oneOffOrgs, recurringOrgs);
        expect(screen.getByTestId("chip-1")).toBeTruthy();
        expect(screen.getByTestId("chip--6")).toBeTruthy();

        for (const providedEventId of [1, -6]) {
          rerender(
            <WorkoutDetailsContent
              locationId={10}
              providedEventId={providedEventId}
              chipSize="small"
            />,
          );
          expectOrgs(
            providedEventId === 1 ? recurringOrgs : oneOffOrgs,
            providedEventId === 1 ? oneOffOrgs : recurringOrgs,
          );
        }
      });

      it("opens the selected workout's AO and region logos at full size", () => {
        const openModal = vi
          .spyOn(modal, "openModal")
          .mockImplementation(() => undefined);
        try {
          const { rerender } = renderPanel(-6);

          for (const [providedEventId, orgs] of [
            [-6, oneOffOrgs],
            [1, recurringOrgs],
          ] as const) {
            rerender(
              <WorkoutDetailsContent
                locationId={10}
                providedEventId={providedEventId}
                chipSize="small"
              />,
            );
            fireEvent.click(
              screen.getByRole("button", {
                name: `Logo for ${orgs.parentName}`,
              }),
            );
            expect(openModal).toHaveBeenLastCalledWith(
              modal.ModalType.FULL_IMAGE,
              {
                title: `${orgs.parentName} logo`,
                src: orgs.parentLogo,
                fallbackSrc: "/f3_logo.png",
                alt: `Logo for ${orgs.parentName}`,
              },
            );

            fireEvent.click(
              screen.getByRole("button", { name: orgs.regionName }),
            );
            expect(openModal).toHaveBeenLastCalledWith(
              modal.ModalType.FULL_IMAGE,
              {
                title: orgs.regionName,
                src: orgs.regionLogo,
                fallbackSrc: "/f3_logo.png",
                alt: orgs.regionName,
              },
            );
          }
          expect(openModal).toHaveBeenCalledTimes(4);
        } finally {
          openModal.mockRestore();
        }
      });

      it.each([
        { name: "empty", instanceOrgs: [] },
        {
          name: "missing the selected instance",
          instanceOrgs: [{ ...oneOffOrgs, instanceId: 5 }],
        },
      ])(
        "does not substitute recurring orgs when instance metadata is $name",
        ({ instanceOrgs }) => {
          queryStates.set("locationWorkout", {
            data: locationWorkout(
              [locationEvent()],
              instanceOrgs,
              recurringLocationOrgs,
            ),
          });

          renderPanel(-6);

          expect(warning()).toBeNull();
          expect(screen.getByAltText("Logo for F3")).toBeTruthy();
          expect(regionHeading("Metro")).toBeNull();
          expect(screen.queryByAltText("Metro")).toBeNull();
          expect(aoContactLink("Alpha AO")).toBeNull();
          expect(
            document.querySelector('a[href="https://metro.example"]'),
          ).toBeNull();
        },
      );
    });
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
