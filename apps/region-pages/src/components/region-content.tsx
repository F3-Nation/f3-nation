"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useState } from "react";
import { RegionHeader } from "@/components/region-header";
import { WorkoutList } from "@/components/workout-list";
import { WorkoutFilters } from "@/components/workout-filters";
import { getMapUrl } from "@/lib/map-utils";
import type { MapParameters } from "@/lib/map-utils";
import type { Region, Workout } from "@/types/region";
import type { RegionEvent } from "@/types/event";
import {
  buildEventSlug,
  formatEventDate,
  formatEventTimeRange,
} from "@/lib/region-events";
import { useRegionDescription } from "@/lib/region-description";

interface RegionContentProps {
  regionSlug: string;
  regionName: string;
  regionDescription?: string;
  website?: string;
  email?: string;
  facebook?: string;
  twitter?: string;
  instagram?: string;
  image?: string;
  sortedWorkouts: Workout[];
  mapParams: MapParameters;
  upcomingEvents?: RegionEvent[];
}

function FilteredContent({ sortedWorkouts }: { sortedWorkouts: Workout[] }) {
  return (
    <>
      <div className="sticky top-4 z-20 mb-8 rounded-lg border border-gray-100 bg-white px-4 py-3 shadow-lg backdrop-blur-xs dark:border-gray-700/50 dark:bg-gray-800/95">
        <Suspense fallback={<div>Loading filters...</div>}>
          <WorkoutFilters workouts={sortedWorkouts} />
        </Suspense>
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-2xl font-semibold">Workouts</h2>
        <Suspense fallback={<div>Loading workouts...</div>}>
          <WorkoutList workouts={sortedWorkouts} />
        </Suspense>
      </div>
    </>
  );
}

// --- OrphanedRegionContent ---

interface OrphanedRegionContentProps {
  region: Region;
}

export function OrphanedRegionContent({ region }: OrphanedRegionContentProps) {
  const description = useRegionDescription(region.description);

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Back to Regions link */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          <svg
            className="mr-2 h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Regions
        </Link>
      </div>

      {/* Region header */}
      <div className="mb-8">
        <h1 className="mb-2 flex items-center text-4xl font-bold">
          F3 {region.name}
        </h1>
        <p className="mb-4 text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      <RegionHeader
        regionName={region.name}
        website={region.website ?? undefined}
        email={region.email ?? undefined}
        facebook={region.facebook ?? undefined}
        twitter={region.twitter ?? undefined}
        instagram={region.instagram ?? undefined}
      />

      {/* No workouts yet card */}
      <div className="mb-8 rounded-lg border border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 p-6 dark:border-yellow-700 dark:from-yellow-900/20 dark:to-amber-900/20">
        <div className="mb-2 flex items-center space-x-3">
          <svg
            className="h-7 w-7 text-yellow-500 dark:text-yellow-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
            This region is just getting started!
          </span>
        </div>
        <div className="mb-3 text-base text-yellow-800 dark:text-yellow-200">
          No workouts have been added yet. Regional admins can help the region
          grow by adding new workout locations (AOs).
        </div>
        <a
          href="https://docs.google.com/document/d/1ssUnIRTfteZH8GcV8K8x0c1q-cGfCu72CdhTIXSJnWI/edit?tab=t.0#heading=h.39rghinjgybm"
          className="inline-block rounded-lg bg-yellow-500 px-5 py-2 text-base font-medium text-white shadow-md transition-colors hover:bg-yellow-600"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get Access to Add AOs
        </a>
        <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
          Follow the Getting Access guide to add new workout locations.
        </div>
      </div>

      {/* Help section */}
      <div className="mt-12 flex w-full flex-col gap-5 rounded-xl border border-gray-200 bg-white/80 p-6 shadow-lg dark:border-gray-700 dark:bg-gray-900/60">
        <div className="mb-1 text-lg font-semibold text-gray-800 dark:text-gray-100">
          Need help?
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
          <div className="flex items-center gap-3">
            <a
              href="https://f3nation.com/locations#faqs"
              className="inline-block rounded-full bg-blue-50 px-4 py-1 text-base font-medium text-blue-700 shadow-xs transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              Locations FAQ
            </a>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-[#f8fafc] px-3 py-1 font-mono text-base text-[#611f69] shadow-xs dark:border-gray-700 dark:bg-gray-800 dark:text-[#ecb22e]">
              <Link
                href="https://f3nation.slack.com/archives/C504D9FRA"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                #tech
              </Link>
            </span>
            <span className="text-base text-gray-600 dark:text-gray-300">
              on the F3 Nation Slack
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RegionContent({
  regionSlug,
  regionName,
  regionDescription,
  website,
  email,
  facebook,
  twitter,
  instagram,
  image,
  sortedWorkouts,
  mapParams,
  upcomingEvents,
}: RegionContentProps) {
  const mapUrl = getMapUrl(mapParams);
  const hasUpcomingEvents =
    Array.isArray(upcomingEvents) && upcomingEvents.length > 0;
  const eventsToShow = upcomingEvents ?? [];
  const [logoError, setLogoError] = useState(false);
  const isFallbackLogo = !image || logoError;
  const description = useRegionDescription(regionDescription);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          <svg
            className="mr-2 h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Regions
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="mb-2 flex items-center text-4xl font-bold">
          {isFallbackLogo ? (
            <>
              <Image
                src="/f3.svg"
                alt={`${regionName} logo`}
                width={150}
                height={150}
                className="mr-2 mb-4 size-37.5 dark:hidden"
                priority={true}
              />
              <Image
                src="/f3-white.svg"
                alt={`${regionName} logo`}
                width={150}
                height={150}
                className="mr-2 mb-4 hidden size-37.5 dark:block"
                priority={true}
              />
            </>
          ) : (
            <Image
              src={image}
              alt={regionName}
              width={150}
              height={150}
              className="mr-2 mb-4 size-37.5"
              priority={true}
              onError={() => setLogoError(true)}
            />
          )}
          F3 {regionName}
        </h1>
        <p className="mb-4 text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      <RegionHeader
        regionName={regionName}
        website={website}
        email={email}
        facebook={facebook}
        twitter={twitter}
        instagram={instagram}
      />

      {hasUpcomingEvents ? (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Upcoming Events
            </h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Stay tuned and bring an FNG.
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-blue-200/70 bg-blue-50/40 dark:border-blue-800/60 dark:bg-blue-950/10">
            {eventsToShow.map((event) => {
              const formattedDate = event.date
                ? formatEventDate(event.date)
                : undefined;
              const timeRange = formatEventTimeRange(
                event.startTime,
                event.endTime,
              );
              const eventMeta = [formattedDate, timeRange]
                .filter(Boolean)
                .join(" • ");
              const supportingText = event.location?.name ?? event.summary;

              return (
                <Link
                  key={event.id}
                  href={`/${regionSlug}/events/${buildEventSlug(event)}`}
                  className="flex flex-col gap-2 border-b border-blue-200/70 px-5 py-4 text-blue-900 transition-colors last:border-b-0 hover:bg-blue-100/60 focus-visible:bg-blue-100/60 dark:border-blue-800/60 dark:text-blue-100 dark:hover:bg-blue-900/30 dark:focus-visible:bg-blue-900/30"
                >
                  {eventMeta || event.type ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-200">
                      {eventMeta ? <span>{eventMeta}</span> : null}
                      {event.type ? (
                        <span className="ml-auto inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-blue-800 uppercase dark:bg-blue-900/50 dark:text-blue-100">
                          {event.type}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <h3 className="text-lg font-semibold text-blue-900 md:pr-6 dark:text-blue-50">
                      {event.title}
                    </h3>
                    <span className="text-sm font-medium text-blue-600 md:ml-auto dark:text-blue-200">
                      View details →
                    </span>
                  </div>
                  {supportingText ? (
                    <p className="text-sm text-blue-800/80 dark:text-blue-200/80">
                      {supportingText}
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Personalized Maps CTA Banner */}
      <div className="mb-8 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg
              className="h-6 w-6 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <div>
              <span className="font-medium text-green-900 dark:text-green-100">
                View {regionName} on the Map
              </span>
              <p className="text-sm text-green-700 dark:text-green-300">
                See all workout locations and get directions
              </p>
            </div>
          </div>
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            Open Map →
          </a>
        </div>
      </div>

      <Suspense fallback={<div>Loading content...</div>}>
        <FilteredContent sortedWorkouts={sortedWorkouts} />
      </Suspense>
    </div>
  );
}
