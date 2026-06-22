import dayjs from "dayjs";
import gte from "lodash/gte";
import { Edit, PlusCircle, Trash } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { isProd } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { invalidateQueries, orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import { dateToDayOfWeek } from "~/utils/date-to-day-of-week";
import { getWhenFromWorkout } from "~/utils/get-when-from-workout";
import { useUpdateEventSearchParams } from "~/utils/hooks/use-update-event-search-params";
import { getStatusSolidBg } from "~/utils/map-status-colors";
import { appStore } from "~/utils/store/app";
import {
  DeleteType,
  ModalType,
  eventAndLocationToUpdateRequest,
  eventDefaults,
  modalStore,
  openModal,
} from "~/utils/store/modal";
import textLink from "~/utils/text-link";
import { ContactLinks } from "../contact-links";
import { ImageWithFallback } from "@acme/ui/image-with-fallback";
import { EventChip } from "../map/event-chip";
import { WorkoutDetailsSkeleton } from "../modal/workout-details-skeleton";
import { DeletedWorkoutWarning } from "./deleted-workout-warning";
import type { MapStatus } from "~/utils/types";

type WorkoutDetailsEvent = NonNullable<
  NonNullable<
    RouterOutputs["map"]["location"]["locationWorkout"]["location"]
  >["events"][number]
>;
type UpcomingInstance =
  RouterOutputs["map"]["location"]["upcomingInstances"][number];

function getUpdateStatusColor(instance: {
  seriesException: string | null;
  seriesId: number | null;
}) {
  if (instance.seriesException === "closed") return getStatusSolidBg("closed");
  if (instance.seriesException === "different-time")
    return getStatusSolidBg("different-time");
  if (instance.seriesException) return getStatusSolidBg("miscellaneous");
  return getStatusSolidBg("event-instance");
}

function formatUpdateText(instance: {
  startDate: string;
  startTime: string | null;
  name: string;
}) {
  const date = dayjs(instance.startDate).format("M/D");
  const time = instance.startTime
    ? dayjs(instance.startTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      )
    : null;
  return time
    ? `${date} - ${instance.name} at ${time}`
    : `${date} - ${instance.name}`;
}

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
  const router = useRouter();
  const { data: session } = useSession();
  const { data: results, isLoading } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId },
      enabled: locationId >= 0,
    }),
  );

  const { data: upcomingInstancesData } = useQuery(
    orpc.map.location.upcomingInstances.queryOptions({
      input: undefined,
    }),
  );

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

  const { data: parentEventResponse } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: selectedSeriesId ?? -1 },
      enabled: (selectedSeriesId ?? 0) > 0,
    }),
  );

  const { data: canDeleteEventResponse } = useQuery(
    orpc.request.canDeleteEvent.queryOptions({
      input: { eventId: selectedEventId ?? 0 },
      enabled: !!selectedEventId && selectedEventId > 0,
    }),
  );
  const canDeleteEvent = canDeleteEventResponse?.canDelete;

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

    if (seriesId != null) {
      return upcomingInstancesData.filter((i) => i.seriesId === seriesId);
    }

    return selectedInstance
      ? upcomingInstancesData.filter((i) => i.id === selectedInstance.id)
      : [];
  }, [selectedEventId, upcomingInstancesData, selectedInstance]);

  const baseEventIds = useMemo(
    () => new Set((results?.location?.events ?? []).map((e) => e.id)),
    [results?.location?.events],
  );

  const eventStatusMap = useMemo(() => {
    const map = new Map<number, MapStatus>();
    const nearestDate = new Map<number, string>();
    for (const instance of locationInstances) {
      const isOrphan =
        instance.seriesId == null || !baseEventIds.has(instance.seriesId);

      if (isOrphan) {
        const status: MapStatus =
          instance.seriesException === "closed"
            ? "closed"
            : instance.seriesException === "different-time"
              ? "different-time"
              : instance.seriesException
                ? "miscellaneous"
                : "event-instance";
        map.set(-instance.id, status);
      } else {
        const existing = nearestDate.get(instance.seriesId!);
        if (!existing || instance.startDate < existing) {
          nearestDate.set(instance.seriesId!, instance.startDate);
          const status: MapStatus =
            instance.seriesException === "closed"
              ? "closed"
              : instance.seriesException === "different-time"
                ? "different-time"
                : instance.seriesException
                  ? "miscellaneous"
                  : "event-instance";
          map.set(instance.seriesId!, status);
        }
      }
    }
    return map;
  }, [locationInstances, baseEventIds]);

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

  const mode = appStore.use.mode();

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
      aoId: parentEvent.aos[0]?.aoId ?? null,
      aoName: parentEvent.aos[0]?.aoName ?? null,
      aoLogo: null,
      aoWebsite: null,
    };
  }, [selectedEventId, displayedEvents, parentEventResponse]);

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
    () =>
      aoContact &&
      (aoContact.website ??
        aoContact.email ??
        aoContact.phone ??
        aoContact.twitter ??
        aoContact.facebook ??
        aoContact.instagram),
    [aoContact],
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
            When: event ? getWhenFromWorkout(event) : "",
            Contact:
              hasAoContact && aoContact ? (
                <ContactLinks contact={aoContact} iconSize="sm" />
              ) : null,
            Notes: event?.description ? textLink(event.description) : null,
          }
        : {},
    [event, location, aoContact, hasAoContact],
  );

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

  const regionFields = useMemo(
    () =>
      location
        ? {
            Name: location.regionName ? `F3 ${location.regionName}` : null,
            Contact:
              hasRegionContact && regionContact ? (
                <ContactLinks contact={regionContact} iconSize="sm" />
              ) : null,
            Logo: location.regionLogo ? (
              <ImageWithFallback
                key={location.regionLogo}
                src={location.regionLogo}
                fallbackSrc="/f3_logo.png"
                loading="lazy"
                width={64}
                height={64}
                alt={location.regionName ?? "F3 logo"}
                className="rounded-lg bg-black"
              />
            ) : null,
          }
        : {},
    [location, regionContact, hasRegionContact],
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
  if (!event && location?.events.length === 0) {
    return <DeletedWorkoutWarning text="Event is unavailable." />;
  }

  return (
    <>
      <div className="flex flex-row flex-wrap items-center justify-start gap-x-2">
        <div className="flex flex-shrink-0 flex-col items-center">
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
        <div className="line-clamp-2 flex-1 text-left text-2xl font-bold leading-6 sm:text-4xl">
          {event?.name ?? location.parentName ?? "Workout Information"}
        </div>
      </div>

      {mode === "edit" && selectedEventId != null && selectedEventId > 0 ? (
        <button
          className={cn(
            "-mt-2 flex w-fit flex-row items-center gap-2 rounded-sm bg-blue-600 px-2 text-white sm:mt-1",
          )}
          onClick={() => {
            openModal(ModalType.UPDATE_LOCATION, {
              requestType: "edit",
              ...eventAndLocationToUpdateRequest({
                event,
                location,
              }),
            });
          }}
        >
          <Edit className="h-4 w-4" />
          <span>Edit Workout</span>
        </button>
      ) : null}

      {selectedEventUpdates.length > 0 && (
        <div className="mt-1">
          <div className="text-sm font-bold">Updates</div>
          <div className="mt-1 flex flex-col gap-1">
            {selectedEventUpdates.map((instance) => (
              <div
                key={instance.id}
                className="flex items-center gap-2 text-sm"
              >
                <div
                  className={cn(
                    "h-3 w-3 flex-shrink-0 rounded-sm",
                    getUpdateStatusColor(instance),
                  )}
                />
                <span>{formatUpdateText(instance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
          {mode === "edit" ? (
            <button
              className={cn(
                "flex cursor-pointer flex-row items-center",
                "rounded-sm",
                "text-base text-white",
                "px-2 shadow",
                { "pointer-events-auto bg-blue-600": true },
                { "gap-2 py-0": true },
              )}
              onClick={() => {
                openModal(ModalType.UPDATE_LOCATION, {
                  requestType: "create_event",
                  ...eventDefaults,
                  ...eventAndLocationToUpdateRequest({
                    event: undefined,
                    location,
                  }),
                });
              }}
            >
              <PlusCircle className="h-4 w-4" />
              <span>Add Workout</span>
            </button>
          ) : null}
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
                    <dd className="mt-1 whitespace-pre-line text-sm text-foreground">
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

      <div className="mt-4 text-xl font-bold">Region Information</div>
      <div className="w-full [&_dd]:[overflow-wrap:anywhere]">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
          {Object.keys(regionFields)
            .filter(
              (field) => !!regionFields[field as keyof typeof regionFields],
            )
            .map((field) => (
              <div key={field} className="sm:col-span-1">
                <dt className="text-sm font-medium text-muted-foreground">
                  {field}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {regionFields[field as keyof typeof regionFields]}
                </dd>
              </div>
            ))}
        </dl>
      </div>

      {event && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onCopyLink}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
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

      {mode === "edit" && selectedEventId != null && selectedEventId > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <button
            className="flex flex-row items-center justify-center gap-2 rounded-md bg-blue-600 px-2 py-1 text-white"
            onClick={() => {
              openModal(ModalType.UPDATE_LOCATION, {
                requestType: "edit",
                ...eventAndLocationToUpdateRequest({
                  event,
                  location,
                }),
              });
            }}
          >
            <Edit className="h-4 w-4" />
            <span>Edit Workout</span>
          </button>

          <button
            className={cn(
              "flex flex-row items-center justify-center gap-2 rounded-md px-2 py-1",
              {
                "text-red-600 hover:text-red-700": !canDeleteEvent,
                "cursor-not-allowed text-gray-400": canDeleteEvent,
              },
            )}
            disabled={!!canDeleteEvent}
            onClick={() => {
              openModal(ModalType.DELETE_CONFIRMATION, {
                type: DeleteType.EVENT,
                onConfirm: () => {
                  if (location.regionId == null) {
                    return;
                  }
                  if (!location.regionId || !selectedEventId) return;

                  const event = location.events.find(
                    (e) => e.id === selectedEventId,
                  );
                  if (!event) return;

                  void orpc.request.submitDeleteRequest
                    .call({
                      regionId: location.regionId,
                      eventId: event.id,
                      eventName: event.name,
                      submittedBy: session?.user?.email ?? "",
                    })
                    .then((result) => {
                      void invalidateQueries("location");
                      void invalidateQueries({
                        queryKey: orpc.request.canDeleteEvent.queryKey({
                          input: { eventId: event.id },
                        }),
                        exact: false,
                      });
                      router.refresh();
                      toast.success(
                        result.status === "pending"
                          ? "Delete request submitted"
                          : "Successfully deleted event",
                      );
                      // Close all modals
                      modalStore.setState({ modals: [] });
                    });
                },
              });
            }}
          >
            <Trash className="h-4 w-4" />
            <span>
              {canDeleteEvent ? "Delete Request Submitted" : "Delete Workout"}
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
};
