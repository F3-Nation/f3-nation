import gte from "lodash/gte";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import { isProd } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import {
  dateToDayOfWeek,
  getWhenFromWorkout,
  sortUpcomingInstancesByDate,
} from "~/utils/date";
import {
  buildEventStatusMap,
  findNextExceptionNotice,
  selectStatusInstances,
} from "~/utils/event-status-map";
import { getEndDateLabel } from "~/utils/get-end-date-label";
import { useUpcomingInstances } from "~/utils/hooks/use-upcoming-instances";
import { useUpdateEventSearchParams } from "~/utils/hooks/use-update-event-search-params";
import { ModalType, openModal } from "~/utils/store/modal";
import textLink from "~/utils/text-link";
import { ContactLinks } from "../contact-links";
import { ImageWithFallback } from "@acme/ui/image-with-fallback";
import { EventChip } from "../map/event-chip";
import { ScheduleChangesNotice } from "../map/schedule-changes-notice";
import { WorkoutDetailsSkeleton } from "../modal/workout-details-skeleton";
import { DeletedWorkoutWarning } from "./deleted-workout-warning";
import { ExceptionNotice } from "./exception-notice";
import { UpdatesCallout } from "./updates-callout";
import type { MapStatus } from "~/utils/types";

type WorkoutDetailsEvent = NonNullable<
  NonNullable<
    RouterOutputs["map"]["location"]["locationWorkout"]["location"]
  >["events"][number]
>;
type UpcomingInstance =
  RouterOutputs["map"]["location"]["upcomingInstances"][number];

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

export interface WorkoutDetailsContentProps {
  locationId: number;
  providedEventId: number | null;
  chipSize: "small" | "medium" | "large";
}

export const WorkoutDetailsContent = ({
  locationId,
  providedEventId,
  chipSize,
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

  const selectedSeriesId = useMemo(() => {
    if (providedEventId == null) return null;
    if (providedEventId > 0) return providedEventId;
    return (
      upcomingInstancesData?.find((i) => i.id === -providedEventId)?.seriesId ??
      null
    );
  }, [providedEventId, upcomingInstancesData]);

  const selectedEventId = useMemo(() => {
    if (providedEventId) return providedEventId;
    return results?.location?.events?.[0]?.id ?? null;
  }, [providedEventId, results]);

  const selectedInstance = useMemo(() => {
    if (selectedEventId == null || selectedEventId >= 0) return undefined;
    return upcomingInstancesData?.find(
      (instance) => instance.id === -selectedEventId,
    );
  }, [selectedEventId, upcomingInstancesData]);

  const locationInstances = useMemo(() => {
    const currentLocation = results?.location;
    if (!upcomingInstancesData || !currentLocation) return [];
    return upcomingInstancesData.filter(
      (instance) => instance.locationId === currentLocation.id,
    );
  }, [upcomingInstancesData, results?.location]);

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

  const { data: parentEventResponse, isError: isParentEventError } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: selectedSeriesId ?? -1 },
      enabled: needsParentEventFallback,
    }),
  );

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
    const needsInstanceList = providedEventId != null && providedEventId < 0;
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
    upcomingInstancesData,
    isUpcomingInstancesError,
    needsParentEventFallback,
    parentEventResponse,
    isParentEventError,
  ]);

  const location = useMemo(() => results?.location ?? null, [results]);

  // Update the search params when the panel is open
  useUpdateEventSearchParams(location?.id ?? null, selectedEventId);

  const isLongNotes = useMemo(() => {
    return gte(event?.description?.length, 300);
  }, [event?.description]);

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

  const hasAoContact = useMemo(
    () => !!aoContact && Object.values(aoContact).some(Boolean),
    [aoContact],
  );

  const whenText = useMemo(
    () => (event ? getWhenFromWorkout(event) : ""),
    [event],
  );

  const endDateLabel = useMemo(
    () => getEndDateLabel(event?.endDate),
    [event?.endDate],
  );

  const whenException = useMemo(
    () => findNextExceptionNotice(event, upcomingInstancesData),
    [event, upcomingInstancesData],
  );

  const workoutFields = useMemo(
    () =>
      event && location
        ? {
            Name: (
              <>
                {event.name}
                {!isProd ? (
                  <p className="text-xs text-muted-foreground">
                    event: {event.id}; loc: {location.id}
                  </p>
                ) : null}
              </>
            ),
            What: event?.eventTypes.map((type) => type.name).join(", "),
            Where: [
              <Link
                key="fullAddress"
                href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {location.fullAddress ?? "Directions"}
              </Link>,
              location.locationDescription ? (
                <p
                  key="locationDescription"
                  className="text-sm text-muted-foreground"
                >
                  {location.locationDescription}
                </p>
              ) : null,
            ].filter(isTruthy),
            When:
              whenText || endDateLabel || whenException ? (
                <>
                  {whenText}
                  {endDateLabel ? (
                    <p className="text-sm">{endDateLabel}</p>
                  ) : null}
                  {whenException ? (
                    <ExceptionNotice notice={whenException} />
                  ) : null}
                </>
              ) : null,
            Contact:
              hasAoContact && aoContact ? (
                <ContactLinks contact={aoContact} iconSize="sm" />
              ) : null,
            Notes: event?.description ? textLink(event.description) : null,
          }
        : {},
    [
      event,
      location,
      aoContact,
      hasAoContact,
      whenText,
      endDateLabel,
      whenException,
    ],
  );

  const hasMultipleWorkouts = (results?.location?.events.length ?? 0) > 1;
  const shouldShowAOSection = hasMultipleWorkouts && event?.aoName;

  const regionContact = useMemo(
    () =>
      location
        ? {
            website: location.regionWebsite,
            email: location.regionEmail,
            phone: location.regionPhone,
            twitter: location.regionTwitter,
            facebook: location.regionFacebook,
            instagram: location.regionInstagram,
          }
        : null,
    [location],
  );

  const hasRegionContact = useMemo(
    () =>
      regionContact &&
      (regionContact.website ??
        regionContact.email ??
        regionContact.phone ??
        regionContact.twitter ??
        regionContact.facebook ??
        regionContact.instagram),
    [regionContact],
  );

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

  return (
    <>
      <div className="flex flex-row flex-wrap items-center justify-start gap-x-2">
        <div className="flex shrink-0 flex-col items-center">
          <button
            className="cursor-pointer"
            onClick={() =>
              openModal(ModalType.FULL_IMAGE, {
                title: `${location.parentName} logo`,
                src:
                  location.parentLogo ?? location.regionLogo ?? "/f3_logo.png",
                fallbackSrc: "/f3_logo.png",
                alt: `Logo for ${location.parentName ?? "F3"}`,
              })
            }
          >
            <ImageWithFallback
              key={location.parentLogo ?? location.regionLogo}
              src={location.parentLogo ?? location.regionLogo ?? "/f3_logo.png"}
              fallbackSrc="/f3_logo.png"
              loading="lazy"
              width={64}
              height={64}
              alt={`Logo for ${location.parentName ?? "F3"}`}
              className="rounded-lg bg-black"
            />
          </button>
        </div>
        <div className="line-clamp-2 flex-1 text-left text-2xl leading-tight font-bold sm:text-4xl">
          {event?.name ?? location.parentName ?? "Workout Information"}
        </div>
      </div>

      <UpdatesCallout instances={selectedEventUpdates} />
      <ScheduleChangesNotice className="m-0 mt-2 w-full" />

      <div>
        {displayedEvents.length > 1 ? (
          <span className="text-sm">
            There are {displayedEvents.length} workouts at this location
          </span>
        ) : (
          <div className="h-1" />
        )}
        <div className="flex flex-row flex-wrap gap-1">
          {displayedEvents.map((locEvent) => (
            <EventChip
              key={locEvent.id}
              selected={selectedEventId === locEvent.id}
              mapStatus={eventStatusMap.get(locEvent.id) ?? null}
              event={{
                id: locEvent.id,
                name: locEvent.name,
                locationId: location?.id ?? 0,
                dayOfWeek: locEvent.dayOfWeek,
                startTime: locEvent.startTime,
                endTime: locEvent.endTime,
                eventTypes: locEvent.eventTypes,
              }}
              location={{
                lat: location?.lat ?? null,
                lon: location?.lon ?? null,
                id: location?.id ?? 0,
              }}
              size={chipSize}
              hideName={displayedEvents.length === 1}
            />
          ))}
        </div>
      </div>

      {event && (
        <div className="mt-2 w-full">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-4 break-words sm:grid-cols-2">
            {Object.keys(workoutFields)
              .filter(
                (field) => !!workoutFields[field as keyof typeof workoutFields],
              )
              .map((field) => {
                return (
                  <div
                    key={field}
                    className={cn("col-span-2 sm:col-span-1", {
                      "col-span-2 sm:col-span-2":
                        // Since website is before notes
                        isLongNotes &&
                        (field === "Notes" || field === "Website"),
                    })}
                  >
                    <dt className="text-sm font-medium text-muted-foreground">
                      {field}
                    </dt>
                    <dd className="mt-1 text-sm whitespace-pre-line text-foreground">
                      {workoutFields[field as keyof typeof workoutFields]}
                    </dd>
                  </div>
                );
              })}

            <div className="col-span-2 sm:col-span-2">
              <dt className="text-sm font-medium text-muted-foreground">How</dt>
              <dd className="mt-1 max-w-prose space-y-5 text-sm text-foreground">
                All F3 events are free and open to all men. If this is your
                first time, simply show up at the time and place and join us. Be
                prepared to sweat! We look forward to meeting you.
                <p className="mt-2">
                  <Link
                    href="https://f3nation.com/about-f3"
                    target="_blank"
                    className="inline-flex items-center gap-1 text-blue-600 underline hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    FAQs and more about F3 Nation
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="lucide lucide-external-link"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </Link>
                </p>
              </dd>
            </div>
          </dl>
        </div>
      )}

      {shouldShowAOSection && (
        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-3 flex items-start gap-3">
            {event.aoLogo ? (
              <button
                className="cursor-pointer"
                onClick={() =>
                  openModal(ModalType.FULL_IMAGE, {
                    title: event.aoName ?? "AO logo",
                    src: event.aoLogo ?? "/f3_logo.png",
                    fallbackSrc: "/f3_logo.png",
                    alt: event.aoName ?? "AO logo",
                  })
                }
              >
                <ImageWithFallback
                  key={event.aoLogo}
                  src={event.aoLogo}
                  fallbackSrc="/f3_logo.png"
                  loading="lazy"
                  width={48}
                  height={48}
                  alt={event.aoName ?? "AO logo"}
                  className="rounded-lg bg-black"
                />
              </button>
            ) : null}
            <div className="flex-1">
              <h3 className="text-lg font-semibold">About {event.aoName}</h3>
              <p className="text-sm text-muted-foreground">
                This workout is part of the {event.aoName} AO (Area of
                Operation)
              </p>
            </div>
          </div>
          {event.aoWebsite && (
            <Link
              href={event.aoWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 underline hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              Visit AO Website
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-3 flex items-start gap-3">
          {location.regionLogo && (
            <button
              className="cursor-pointer"
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
                src={location.regionLogo}
                fallbackSrc="/f3_logo.png"
                loading="lazy"
                width={48}
                height={48}
                alt={location.regionName ?? "Region logo"}
                className="rounded-lg bg-black"
              />
            </button>
          )}
          <div className="flex-1">
            <h3 className="text-lg font-semibold">
              About F3 {location.regionName}
            </h3>
            <p className="text-sm text-muted-foreground">
              This workout is part of the F3 {location.regionName} region
            </p>
          </div>
        </div>
        {location.regionWebsite && (
          <Link
            href={location.regionWebsite}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 underline hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Visit Region Website
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </Link>
        )}
        {hasRegionContact && regionContact && (
          <ContactLinks
            contact={regionContact}
            iconSize="sm"
            className="mt-3"
          />
        )}
      </div>

      {event && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onCopyLink}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-xs transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-link"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            <span>Copy Link to Event</span>
          </button>
        </div>
      )}
    </>
  );
};
