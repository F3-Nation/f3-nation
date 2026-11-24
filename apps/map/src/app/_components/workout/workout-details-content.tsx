import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Link as LinkIcon,
  Navigation,
} from "lucide-react";

import { isProd } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import { dateToDayOfWeek, sortUpcomingInstancesByDate } from "~/utils/date";
import {
  buildEventStatusMap,
  findNextExceptionNotice,
  selectStatusInstances,
  statusLabel,
} from "~/utils/event-status-map";
import { dayjs } from "~/utils/frontendDayjs";
import { getStatusSolidBg } from "~/utils/map-status-colors";
import { formatTagDate, statusTagText } from "~/utils/status-tag";
import {
  buildWorkoutIcs,
  durationMinutes,
  formatDays,
  formatScheduleBanner,
  formatTimeRange,
  groupLocationWorkouts,
  safeExternalUrl,
} from "~/utils/workout-schedule";
import { getEndDateLabel } from "~/utils/get-end-date-label";
import { useUpcomingInstances } from "~/utils/hooks/use-upcoming-instances";
import { reportQueryError } from "~/utils/report-query-error";
import { useUpdateEventSearchParams } from "~/utils/hooks/use-update-event-search-params";
import { ModalType, openModal } from "~/utils/store/modal";
import { setSelectedItem } from "~/utils/store/selected-item";
import textLink from "~/utils/text-link";
import { ContactLinks } from "../contact-links";
import { ImageWithFallback } from "@acme/ui/image-with-fallback";
import { ScheduleChangesNotice } from "../map/schedule-changes-notice";
import { StatusTagBadge } from "../map/status-tag-badge";
import { WorkoutDetailsSkeleton } from "../modal/workout-details-skeleton";
import { DeletedWorkoutWarning } from "./deleted-workout-warning";
import { UpdatesCallout } from "./updates-callout";
import type { MapStatus } from "~/utils/types";

type WorkoutDetailsEvent = NonNullable<
  NonNullable<
    RouterOutputs["map"]["location"]["locationWorkout"]["location"]
  >["events"][number]
>;
type UpcomingInstance =
  RouterOutputs["map"]["location"]["upcomingInstances"][number];
type InstanceOrgs = NonNullable<
  RouterOutputs["map"]["location"]["locationWorkout"]["location"]
>["instanceOrgs"][number];

const UNKNOWN_ORGS: Omit<InstanceOrgs, "instanceId"> = {
  parentId: null,
  parentLogo: null,
  parentName: null,
  parentWebsite: null,
  parentEmail: null,
  parentPhone: null,
  parentTwitter: null,
  parentFacebook: null,
  parentInstagram: null,
  regionId: null,
  regionName: null,
  regionLogo: null,
  regionWebsite: null,
  regionEmail: null,
  regionPhone: null,
  regionTwitter: null,
  regionFacebook: null,
  regionInstagram: null,
  regionType: null,
};

export function createWorkoutEventFromInstance(
  instance: UpcomingInstance,
): WorkoutDetailsEvent {
  return {
    id: -instance.id,
    name: instance.name,
    description: null,
    dayOfWeek: dateToDayOfWeek(instance.startDate),
    startTime: instance.startTime,
    endTime: instance.endTime,
    eventTypes: instance.eventTypes,
    aoId: null,
    startDate: null,
    endDate: null,
    aoLogo: instance.aoLogo,
    aoWebsite: null,
    aoName: instance.aoName,
  };
}

/** Linked from the "First time?" card; f3nation.com's own page for new men. */
const WHAT_TO_EXPECT_URL = "https://f3nation.com/what-to-expect";
const FIRST_TIME_COPY =
  "Free and open to all men. No sign-up, no gear, no experience. Get there a few minutes early and introduce yourself.";

export interface WorkoutDetailsContentProps {
  locationId: number;
  providedEventId: number | null;
}

export const WorkoutDetailsContent = ({
  locationId,
  providedEventId,
}: WorkoutDetailsContentProps) => {
  const { data: results, isLoading } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId },
      enabled: locationId >= 0,
    }),
  );

  const {
    instances: upcomingInstancesData,
    isUnavailable: isUpcomingInstancesError,
  } = useUpcomingInstances();

  const locationInstances = useMemo(() => {
    const currentLocation = results?.location;
    if (!upcomingInstancesData || !currentLocation) return [];
    // Match the API's location-level fallback order (startDate, startTime, id;
    // Postgres ASC puts a null startTime last) so the default selection is the
    // same instance whose orgs the location reports.
    return upcomingInstancesData
      .filter((instance) => instance.locationId === currentLocation.id)
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          (a.startTime == null ? 1 : 0) - (b.startTime == null ? 1 : 0) ||
          (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
          a.id - b.id,
      );
  }, [upcomingInstancesData, results?.location]);

  const selectedSeriesId = useMemo(() => {
    if (providedEventId == null) return null;
    if (providedEventId > 0) return providedEventId;
    return (
      locationInstances.find((i) => i.id === -providedEventId)?.seriesId ?? null
    );
  }, [providedEventId, locationInstances]);

  const baseEvents = useMemo(
    () => results?.location?.events ?? [],
    [results?.location?.events],
  );

  const baseEventIds = useMemo(
    () => new Set(baseEvents.map((e) => e.id)),
    [baseEvents],
  );

  const eventStatusMap = useMemo(() => {
    const currentLocationId = results?.location?.id;
    if (currentLocationId == null) return new Map<number, MapStatus>();
    return buildEventStatusMap(
      selectStatusInstances(
        upcomingInstancesData ?? [],
        currentLocationId,
        baseEventIds,
      ),
      baseEvents,
    );
  }, [upcomingInstancesData, results?.location?.id, baseEventIds, baseEvents]);

  const instanceEvents = useMemo(
    () =>
      locationInstances
        .filter(
          (instance) =>
            instance.seriesId == null || !baseEventIds.has(instance.seriesId),
        )
        .map((instance) => createWorkoutEventFromInstance(instance)),
    [locationInstances, baseEventIds],
  );

  const displayedEvents = useMemo(() => {
    const combined = [...(results?.location?.events ?? [])];

    for (const instanceEvent of instanceEvents) {
      if (
        !combined.some((existingEvent) => existingEvent.id === instanceEvent.id)
      ) {
        combined.push(instanceEvent);
      }
    }

    return combined;
  }, [results, instanceEvents]);

  // A location whose only workouts are upcoming instances has no series
  // events, so fall back to the first displayed event rather than the first
  // series event — otherwise a pin click with no eventId selects nothing.
  const selectedEventId = useMemo(() => {
    if (providedEventId) return providedEventId;
    return displayedEvents[0]?.id ?? null;
  }, [providedEventId, displayedEvents]);

  const selectedInstance = useMemo(() => {
    if (selectedEventId == null || selectedEventId >= 0) return undefined;
    return locationInstances.find(
      (instance) => instance.id === -selectedEventId,
    );
  }, [selectedEventId, locationInstances]);

  const selectedEventUpdates = useMemo(() => {
    if (selectedEventId == null || !upcomingInstancesData) return [];

    const seriesId =
      selectedEventId > 0
        ? selectedEventId
        : (selectedInstance?.seriesId ?? null);

    const matches =
      seriesId != null
        ? upcomingInstancesData.filter((i) => i.seriesId === seriesId)
        : selectedInstance
          ? upcomingInstancesData.filter((i) => i.id === selectedInstance.id)
          : [];

    // The API returns these unordered, so sort for display — the list reads as
    // a timeline, and the soonest change is the one that matters most.
    return sortUpcomingInstancesByDate(matches);
  }, [selectedEventId, upcomingInstancesData, selectedInstance]);

  // The parent-series lookup is a fallback, not a primary source: it only has
  // something to add when the selected id is absent from the location's own
  // event list (an instance whose series is already listed under its positive
  // id, or a link to an event this location no longer carries). Gating on that
  // absence — once the location query has settled, so the list is real and not
  // merely unloaded — keeps a multi-join fetch off every panel open.
  const needsParentEventFallback =
    (selectedSeriesId ?? 0) > 0 &&
    results?.location != null &&
    !displayedEvents.some((e) => e.id === selectedEventId);

  const {
    data: parentEventResponse,
    isError: isParentEventError,
    error: parentEventError,
  } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: selectedSeriesId ?? -1 },
      enabled: needsParentEventFallback,
      // A failed fallback must degrade to the "workout unavailable" path via
      // `isParentEventError`, not throw into global-error.tsx and replace the
      // whole map (see the app-wide throwOnError in `~/orpc/query-client`).
      // Skipping the throw skips global-error.tsx's capture too, so the effect
      // below reports it.
      throwOnError: false,
    }),
  );

  useEffect(() => {
    reportQueryError(parentEventError, "map.event_by_id.fetch_failed");
  }, [parentEventError]);

  const event = useMemo<WorkoutDetailsEvent | undefined>(() => {
    const displayedEvent = displayedEvents.find(
      (event) => event.id === selectedEventId,
    );
    if (displayedEvent) return displayedEvent;

    const parentEvent = parentEventResponse?.event;
    if (!parentEvent) return undefined;

    return {
      id: parentEvent.id,
      name: parentEvent.name,
      description: parentEvent.description,
      dayOfWeek: parentEvent.dayOfWeek,
      startTime: parentEvent.startTime,
      endTime: parentEvent.endTime,
      eventTypes: parentEvent.eventTypes.map((type) => ({
        id: type.eventTypeId,
        name: type.eventTypeName,
      })),
      startDate: parentEvent.startDate ?? null,
      endDate: parentEvent.endDate ?? null,
      aoId: parentEvent.aos[0]?.aoId ?? null,
      aoName: parentEvent.aos[0]?.aoName ?? null,
      aoLogo: null,
      aoWebsite: null,
    };
  }, [selectedEventId, displayedEvents, parentEventResponse]);

  // `event` resolves from three async sources: the location's own events, the
  // upcoming-instance list (a negative id is an instance), and the
  // parent-series fallback. A missing event only means a broken link once every
  // source that could still supply one has settled — otherwise the panel would
  // flash the deleted-workout warning mid-fetch. A failed query counts as
  // settled: the answer is never arriving.
  const isResolvingEvent = useMemo(() => {
    // With no series events, the default selection can only come from the
    // instance list too.
    const needsInstanceList =
      providedEventId != null
        ? providedEventId < 0
        : results?.location != null && baseEvents.length === 0;
    if (
      needsInstanceList &&
      !upcomingInstancesData &&
      !isUpcomingInstancesError
    ) {
      return true;
    }
    return (
      needsParentEventFallback && !parentEventResponse && !isParentEventError
    );
  }, [
    providedEventId,
    results?.location,
    baseEvents.length,
    upcomingInstancesData,
    isUpcomingInstancesError,
    needsParentEventFallback,
    parentEventResponse,
    isParentEventError,
  ]);

  // Upcoming instances can belong to different orgs from each other and from
  // recurring workouts at the same location. Follow the selected instance's
  // AO/region context; recurring selections keep the location-level fields.
  const location = useMemo(() => {
    const baseLocation = results?.location;
    if (!baseLocation) return null;
    if (!selectedInstance) return baseLocation;
    const selectedInstanceOrgs = baseLocation.instanceOrgs.find(
      (orgs) => orgs.instanceId === selectedInstance.id,
    );
    // The queries can be cached at different times. A local series occurrence
    // can retain its known orgs; one-offs and away occurrences cannot safely
    // borrow another workout's AO or region.
    if (!selectedInstanceOrgs) {
      return selectedInstance.seriesId != null &&
        baseEventIds.has(selectedInstance.seriesId)
        ? baseLocation
        : { ...baseLocation, ...UNKNOWN_ORGS };
    }
    const { instanceId: _instanceId, ...orgs } = selectedInstanceOrgs;
    return { ...baseLocation, ...orgs };
  }, [results, selectedInstance, baseEventIds]);

  // Update the search params when the panel is open
  useUpdateEventSearchParams(location?.id ?? null, selectedEventId);

  const onCopyLink = useCallback(async () => {
    if (location?.id == null || event?.id == null) {
      toast.error("No location or event found");
    }
    const url = `${window.location.origin}/?locationId=${location?.id}&eventId=${event?.id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }, [event?.id, location?.id]);

  const aoContact = useMemo(
    () =>
      location
        ? {
            website: location.parentWebsite,
            email: location.parentEmail,
            phone: location.parentPhone,
            twitter: location.parentTwitter,
            facebook: location.parentFacebook,
            instagram: location.parentInstagram,
          }
        : null,
    [location],
  );

  const endDateLabel = useMemo(
    () => getEndDateLabel(event?.endDate),
    [event?.endDate],
  );

  const whenException = useMemo(
    () => findNextExceptionNotice(event, upcomingInstancesData),
    [event, upcomingInstancesData],
  );

  const workoutGroups = useMemo(
    () => groupLocationWorkouts(displayedEvents),
    [displayedEvents],
  );

  // The selected workout, folded with its other days, plus every other
  // schedule of the same workout here (e.g. Saturday at a later time).
  const selectedGroup = useMemo(
    () =>
      workoutGroups.find((group) =>
        group.events.some((e) => e.id === (event?.id ?? selectedEventId)),
      ),
    [workoutGroups, event?.id, selectedEventId],
  );
  const bannerGroups = useMemo(() => {
    if (!selectedGroup) {
      return event
        ? [
            {
              days: event.dayOfWeek ? [event.dayOfWeek] : [],
              startTime: event.startTime,
              endTime: event.endTime,
            },
          ]
        : [];
    }
    return workoutGroups.filter(
      (group) =>
        group === selectedGroup ||
        (selectedGroup.id > 0 &&
          group.id > 0 &&
          group.name === selectedGroup.name &&
          group.aoName === selectedGroup.aoName),
    );
  }, [workoutGroups, selectedGroup, event]);

  const onAddToCalendar = useCallback(() => {
    if (!event || !location || !event.startTime) return;
    const days =
      selectedGroup?.days ?? (event.dayOfWeek ? [event.dayOfWeek] : []);
    const ics = buildWorkoutIcs(
      {
        id: event.id,
        name: event.name,
        days,
        startTime: event.startTime,
        endTime: event.endTime,
        startDate: selectedInstance?.startDate ?? event.startDate,
        endDate: event.endDate,
        oneOff: event.id < 0,
        location: location.fullAddress,
        description: FIRST_TIME_COPY,
        url: `${window.location.origin}/?locationId=${location.id}&eventId=${event.id}`,
      },
      dayjs().format("YYYY-MM-DD"),
    );
    const href = URL.createObjectURL(
      new Blob([ics], { type: "text/calendar;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${event.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "f3-workout"}.ics`;
    anchor.click();
    URL.revokeObjectURL(href);
  }, [event, location, selectedGroup, selectedInstance]);

  if (isLoading) {
    return <WorkoutDetailsSkeleton />;
  }
  if (!location) {
    return (
      <DeletedWorkoutWarning
        text={results?.message ?? "Location not found or unavailable."}
      />
    );
  }
  // Dont provide a fallback. This is indicative of worse problems
  if (!event && !isResolvingEvent) {
    return <DeletedWorkoutWarning text="Event is unavailable." />;
  }

  const title =
    location.parentName ?? event?.aoName ?? event?.name ?? "Workout";
  const regionTitle = location.regionName
    ? /^f3\b/i.test(location.regionName)
      ? location.regionName
      : `F3 ${location.regionName}`
    : null;
  const subtitle = [
    event?.eventTypes.map((type) => type.name).join(", "),
    regionTitle,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerLogo =
    location.parentLogo ?? location.regionLogo ?? "/f3_logo.png";
  const aoPageUrl = safeExternalUrl(event?.aoWebsite ?? location.parentWebsite);
  const statusTag = whenException
    ? {
        status: whenException.status,
        text: statusTagText({
          status: whenException.status,
          kind: "instance",
          date: whenException.startDate,
          startTime: whenException.overrideStartTime,
          closedThrough: null,
        }),
      }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-row items-center gap-3">
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          onClick={() =>
            openModal(ModalType.FULL_IMAGE, {
              title: `${location.parentName} logo`,
              src: headerLogo,
              fallbackSrc: "/f3_logo.png",
              alt: `Logo for ${location.parentName ?? "F3"}`,
            })
          }
        >
          <ImageWithFallback
            key={headerLogo}
            src={headerLogo}
            fallbackSrc="/f3_logo.png"
            loading="lazy"
            width={56}
            height={56}
            alt={`Logo for ${location.parentName ?? "F3"}`}
            className="size-14 rounded-md border border-border bg-black object-contain"
          />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl leading-tight font-extrabold break-words uppercase">
            {title}
          </h2>
          {event && event.name !== title ? (
            <p className="text-sm font-semibold">{event.name}</p>
          ) : null}
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
          {!isProd && event ? (
            <p className="text-[10px] text-muted-foreground">
              event: {event.id}; loc: {location.id}
            </p>
          ) : null}
        </div>
      </div>

      {bannerGroups.length ? (
        <div className="flex flex-col items-start gap-1">
          {bannerGroups.map((group, index) => {
            const text = formatScheduleBanner(group);
            return text ? (
              <span
                key={index}
                className="bg-primary px-3 py-1 text-[11px] font-bold tracking-wider text-primary-foreground uppercase [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]"
              >
                {text}
              </span>
            ) : null;
          })}
          {endDateLabel ? (
            <span className="text-xs text-muted-foreground">
              {endDateLabel}
            </span>
          ) : null}
          {statusTag ? (
            <StatusTagBadge tag={statusTag} className="mt-1" />
          ) : null}
        </div>
      ) : null}

      {selectedEventUpdates.length || isUpcomingInstancesError ? (
        <div className="-mt-3 flex flex-col gap-2">
          <UpdatesCallout instances={selectedEventUpdates} />
          <ScheduleChangesNotice className="m-0 w-full" />
        </div>
      ) : null}

      <section className="flex flex-col gap-1">
        <SectionLabel>Where</SectionLabel>
        <p className="text-sm font-bold">
          {location.fullAddress ?? location.locationName}
        </p>
        {location.locationDescription ? (
          <p className="text-xs whitespace-pre-line text-muted-foreground">
            {location.locationDescription}
          </p>
        ) : null}
        <div className="mt-2 flex flex-row items-center gap-2">
          <Link
            href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-primary-hover flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs font-bold tracking-wide whitespace-nowrap text-primary-foreground uppercase transition-colors"
          >
            <Navigation aria-hidden className="size-4 shrink-0" />
            Get directions
          </Link>
          {event?.startTime ? (
            <IconButton label="Add to calendar" onClick={onAddToCalendar}>
              <CalendarPlus aria-hidden className="size-4" />
            </IconButton>
          ) : null}
          {event ? (
            <IconButton label="Copy Link to Event" onClick={onCopyLink}>
              <LinkIcon aria-hidden className="size-4" />
            </IconButton>
          ) : null}
        </div>
      </section>

      {workoutGroups.length > 1 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>
            {workoutGroups.length} workouts at this location
          </SectionLabel>
          {workoutGroups.map((group) => {
            const viewing = group === selectedGroup;
            const status = group.events
              .map((e) => eventStatusMap.get(e.id) ?? null)
              .find(Boolean);
            const instance =
              group.id < 0
                ? locationInstances.find((i) => i.id === -group.id)
                : undefined;
            const when = [
              instance
                ? formatTagDate(instance.startDate)
                : formatDays(group.days),
              formatTimeRange(group.startTime, group.endTime),
            ]
              .filter(Boolean)
              .join(" · ");
            const duration = durationMinutes(group.startTime, group.endTime);
            const detail = [
              group.eventTypes.map((t) => t.name).join(", "),
              duration ? `${duration} min` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={group.id}
                type="button"
                data-testid={`workout-${group.id}`}
                aria-current={viewing ? "true" : undefined}
                onClick={() => {
                  setSelectedItem({
                    locationId: location.id,
                    eventId: group.id,
                    showPanel: true,
                  });
                }}
                className={cn(
                  "relative flex flex-col items-start rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted",
                  { "border-foreground/40": viewing },
                )}
              >
                {status ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-2 bottom-2 left-0 w-[3px] rounded-r",
                      getStatusSolidBg(status),
                    )}
                  />
                ) : null}
                <span className="flex w-full flex-row items-center justify-between gap-2">
                  <span className="text-sm font-extrabold uppercase">
                    {group.name}
                  </span>
                  {viewing ? (
                    <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                      Viewing
                    </span>
                  ) : null}
                </span>
                {when ? (
                  <span className="text-xs font-semibold">{when}</span>
                ) : null}
                {detail ? (
                  <span className="text-[11px] text-muted-foreground">
                    {detail}
                  </span>
                ) : null}
                {status ? (
                  <span className="mt-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                    {statusLabel(status)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </section>
      ) : null}

      {event?.description ? (
        <section className="flex flex-col gap-1">
          <SectionLabel>Notes</SectionLabel>
          <div className="text-sm whitespace-pre-line">
            {textLink(event.description)}
          </div>
        </section>
      ) : null}

      <section className="rounded-md bg-card p-4">
        <h3 className="text-sm font-extrabold uppercase">
          First time? Just show up.
        </h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {FIRST_TIME_COPY}
        </p>
        <Link
          href={WHAT_TO_EXPECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase hover:text-primary"
        >
          What to expect
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </section>

      {aoContact && Object.values(aoContact).some(Boolean) ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Contact {location.parentName ?? "the AO"}</SectionLabel>
          <ContactLinks contact={aoContact} iconSize="sm" />
        </section>
      ) : null}

      {regionTitle ? (
        <section className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-row items-center gap-3">
            <button
              type="button"
              className="shrink-0 cursor-pointer"
              onClick={() =>
                openModal(ModalType.FULL_IMAGE, {
                  title: location.regionName ?? "Region logo",
                  src: location.regionLogo ?? "/f3_logo.png",
                  fallbackSrc: "/f3_logo.png",
                  alt: location.regionName ?? "Region logo",
                })
              }
            >
              <ImageWithFallback
                key={location.regionLogo}
                src={location.regionLogo ?? "/f3_logo.png"}
                fallbackSrc="/f3_logo.png"
                loading="lazy"
                width={36}
                height={36}
                alt={location.regionName ?? "Region logo"}
                className="size-9 rounded-full border border-border bg-black object-contain"
              />
            </button>
            <div className="min-w-0">
              <p className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                Region
              </p>
              <h3 className="text-sm font-extrabold">{regionTitle}</h3>
            </div>
          </div>
          <ContactLinks
            contact={{
              website: location.regionWebsite,
              email: location.regionEmail,
              phone: location.regionPhone,
              twitter: location.regionTwitter,
              facebook: location.regionFacebook,
              instagram: location.regionInstagram,
            }}
            iconSize="sm"
          />
        </section>
      ) : null}

      {aoPageUrl ? (
        <Link
          href={aoPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[11px] font-bold tracking-wider uppercase hover:text-primary"
        >
          {location.parentName ?? "AO"} page
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
    {children}
  </h3>
);

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-input text-foreground transition-colors hover:bg-muted"
  >
    {children}
    <span className="sr-only">{label}</span>
  </button>
);
