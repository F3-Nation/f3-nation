import gte from "lodash/gte";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import { isProd } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { orpc, useQuery } from "~/orpc/react";
import { getWhenFromWorkout } from "~/utils/get-when-from-workout";
import { useUpdateEventSearchParams } from "~/utils/hooks/use-update-event-search-params";
import { ModalType, openModal } from "~/utils/store/modal";
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

  const hasMultipleWorkouts = (results?.location.events.length ?? 0) > 1;
  const shouldShowAOSection = hasMultipleWorkouts && event?.aoName;

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

      <div>
        {hasMultipleWorkouts ? (
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
    </>
  );
};
