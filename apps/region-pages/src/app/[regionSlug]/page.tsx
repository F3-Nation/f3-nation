import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  OrphanedRegionContent,
  RegionContent,
} from "@/components/region-content";
import { getRegion } from "@/lib/data";
import { regionMapParameters } from "@/lib/map-utils";
import { formatEventDate, getUpcomingRegionEvents } from "@/lib/region-events";
import { SITE_TITLE } from "@/lib/site";
import { sortWorkoutsByDayAndTime } from "@/lib/workout-sorting";

interface RegionPageProps {
  params: Promise<{ regionSlug: string }>;
}

// Must be a literal. 50 min: with DATA_TTL_SECONDS and the API's 60 s cache,
// edits show within an hour (see src/lib/site.ts).
export const revalidate = 3000;
export const dynamicParams = true;

// Rendered on first request and then served from the ISR cache, so neither
// the image build nor CI needs API access.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: RegionPageProps): Promise<Metadata> {
  const { regionSlug } = await params;
  const data = await getRegion(regionSlug);
  if (!data) {
    return {
      title: "Region Not Found",
      description: "The requested F3 region could not be found.",
    };
  }

  const { region, workouts } = data;
  const nextEvent = getUpcomingRegionEvents(regionSlug, { limit: 1 })[0];
  const nextUp = nextEvent
    ? ` Next up: ${nextEvent.title} on ${formatEventDate(nextEvent.date)}.`
    : "";

  // Page-level openGraph replaces the layout's, so restate the shared fields.
  const pageMetadata = (title: string, description: string): Metadata => ({
    title,
    description,
    alternates: { canonical: `/${regionSlug}` },
    openGraph: {
      title,
      description,
      url: `/${regionSlug}`,
      siteName: SITE_TITLE,
      locale: "en_US",
      type: "website",
      ...(region.image ? { images: [{ url: region.image }] } : {}),
    },
  });

  if (!workouts.length) {
    return pageMetadata(
      `F3 ${region.name} - Coming Soon`,
      nextEvent
        ? `F3 ${region.name} is a registered region.${nextUp}`
        : `F3 ${region.name} is a registered region. Check back for upcoming workout schedules or visit our website to get involved.`,
    );
  }

  const locations = [
    ...new Set(workouts.map((w) => w.location).filter(Boolean)),
  ];
  const locationString = locations.length
    ? locations.slice(0, 3).join(", ") +
      (locations.length > 3 ? ", and more" : "")
    : "";
  const cityState =
    region.city && region.state ? `${region.city}, ${region.state}` : null;
  const description = `Find F3 workouts in ${cityState ?? region.name}${
    locationString ? `, serving ${locationString}` : ""
  }. Join us for free, peer-led workouts in your area.`;

  return pageMetadata(
    `F3 ${region.name} Workouts${cityState ? ` (${cityState})` : ""}`,
    `${description}${nextUp}`,
  );
}

export default async function RegionPage({ params }: RegionPageProps) {
  const { regionSlug } = await params;
  const data = await getRegion(regionSlug);
  if (!data) notFound();

  const { region, workouts } = data;
  if (!workouts.length) {
    return <OrphanedRegionContent region={region} />;
  }

  return (
    <RegionContent
      regionSlug={regionSlug}
      regionName={region.name}
      regionDescription={region.description ?? undefined}
      website={region.website ?? undefined}
      email={region.email ?? undefined}
      facebook={region.facebook ?? undefined}
      twitter={region.twitter ?? undefined}
      instagram={region.instagram ?? undefined}
      image={region.image ?? undefined}
      sortedWorkouts={sortWorkoutsByDayAndTime(workouts)}
      mapParams={regionMapParameters(region)}
      upcomingEvents={getUpcomingRegionEvents(regionSlug, { limit: 3 })}
    />
  );
}
