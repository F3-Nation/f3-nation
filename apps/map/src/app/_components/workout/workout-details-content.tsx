import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import gte from "lodash/gte";
import { Edit, PlusCircle, Trash } from "lucide-react";
import { useSession } from "next-auth/react";

import { isProd } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { invalidateQueries, orpc, useQuery } from "~/orpc/react";
import { getWhenFromWorkout } from "~/utils/get-when-from-workout";
import { useUpdateEventSearchParams } from "~/utils/hooks/use-update-event-search-params";
import { appStore } from "~/utils/store/app";
import {
  DeleteType,
  eventAndLocationToUpdateRequest,
  eventDefaults,
  modalStore,
  ModalType,
  openModal,
} from "~/utils/store/modal";
import textLink from "~/utils/text-link";
import { ImageWithFallback } from "../image-with-fallback";
import { EventChip } from "../map/event-chip";
import { WorkoutDetailsSkeleton } from "../modal/workout-details-skeleton";

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

  const selectedEventId = useMemo(() => {
    if (providedEventId) return providedEventId;
    return results?.location.events?.[0]?.id ?? null;
  }, [providedEventId, results]);

  const { data: canDeleteEvent } = useQuery(
    orpc.request.canDeleteEvent.queryOptions({
      input: { eventId: selectedEventId ?? 0 },
      enabled: !!selectedEventId,
    }),
  );

  const mode = appStore.use.mode();

  const event = useMemo(
    () =>
      // Dont provide a fallback. This is indicative of worse problems
      results?.location.events.find((event) => event.id === selectedEventId),
    [selectedEventId, results],
  );
  const location = useMemo(() => results?.location, [results]);

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
            Website: location.parentWebsite ? (
              <Link
                href={location.parentWebsite}
                target="_blank"
                className="underline"
              >
                {location.parentWebsite}
              </Link>
            ) : null,
            Notes: event?.description ? textLink(event.description) : null,
          }
        : {},
    [event, location],
  );

  const regionFields = useMemo(
    () =>
      location
        ? {
            Name: location.regionName ? `F3 ${location.regionName}` : null,
            Website: location.regionWebsite ? (
              <Link
                href={location.regionWebsite}
                target="_blank"
                className="underline"
              >
                {location.regionWebsite}
              </Link>
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
    [location],
  );

  if (!location || !event || isLoading) {
    return <WorkoutDetailsSkeleton />;
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
                src: location.parentLogo ?? "/f3_logo.png",
                fallbackSrc: "/f3_logo.png",
                alt: location.parentLogo ?? "F3 logo",
              })
            }
          >
            <ImageWithFallback
              key={location.parentLogo}
              src={location.parentLogo ?? "/f3_logo.png"}
              fallbackSrc="/f3_logo.png"
              loading="lazy"
              width={64}
              height={64}
              alt={location.parentLogo ?? "F3 logo"}
              className="rounded-lg bg-black"
            />
          </button>
        </div>
        <div className="line-clamp-2 flex-1 text-left text-2xl font-bold leading-6 sm:text-4xl">
          {event?.name ?? "Workout Information"}
        </div>
      </div>

      {mode === "edit" ? (
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

      <div>
        {(results?.location.events.length ?? 0) > 1 ? (
          <span className="text-sm">
            There are {results?.location.events.length} workouts at this
            location
          </span>
        ) : (
          <div className="h-1" />
        )}
        <div className="flex flex-row flex-wrap gap-1">
          {results?.location.events.map((event) => (
            <EventChip
              key={event.id}
              selected={selectedEventId === event.id}
              event={{
                id: event.id,
                name: event.name,
                locationId: results.location.id,
                dayOfWeek: event.dayOfWeek,
                startTime: event.startTime,
                endTime: event.endTime,
                eventTypes: event.eventTypes,
              }}
              location={{
                lat: results.location.lat,
                lon: results.location.lon,
                id: results.location.id,
              }}
              size={chipSize}
              hideName={results.location.events.length === 1}
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
                      isLongNotes && (field === "Notes" || field === "Website"),
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
              All F3 events are free and open to all men. If this is your first
              time, simply show up at the time and place and join us. Be
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

      {mode === "edit" ? (
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
                  if (!results?.location.regionId || !selectedEventId) return;

                  const event = results.location.events.find(
                    (e) => e.id === selectedEventId,
                  );
                  if (!event) return;

                  void orpc.request.submitDeleteRequest
                    .call({
                      regionId: results.location.regionId,
                      eventId: event.id,
                      eventName: event.name,
                      submittedBy: session?.user?.email ?? "",
                    })
                    .then((result) => {
                      void invalidateQueries({
                        predicate: (query) => query.queryKey[0] === "location",
                      });
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
