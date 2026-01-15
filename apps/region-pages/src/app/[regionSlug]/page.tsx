// Step 3: Implement ISR with Dynamic Routes
// Edit app/[regionSlug]/page.tsx

import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import {
  fetchRegions,
  fetchWorkoutLocationsByRegion,
  fetchRegionBySlug,
} from '@/utils/fetchWorkoutLocations';
import { sortWorkoutsByDayAndTime } from '@/utils/workoutSorting';
import { calculateMapParameters } from '@/utils/mapUtils';
import {
  RegionContent,
  OrphanedRegionContent,
} from '@/components/RegionContent';
import { formatEventDate, getUpcomingRegionEvents } from '@/utils/regionEvents';

interface RegionProps {
  params: Promise<{
    regionSlug: string;
  }>;
}

export const generateStaticParams = async () =>
  (await fetchRegions()).map((region) => ({
    id: region.id,
    regionName: region.name,
    regionSlug: region.slug || '',
  }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ regionSlug: string }>;
}): Promise<Metadata> {
  const { regionSlug } = await params;
  const region = await fetchRegionBySlug(regionSlug);
  if (!region) {
    return {
      title: 'Region Not Found',
      description: 'The requested F3 region could not be found.',
    };
  }
  const upcomingEvents = getUpcomingRegionEvents(regionSlug, { limit: 1 });
  const regionData = await fetchWorkoutLocationsByRegion(regionSlug);
  const hasWorkouts =
    regionData.length > 0 && regionData[0].id !== 'no-workouts';
  if (!hasWorkouts) {
    const nextEvent = upcomingEvents[0];
    return {
      title: `F3 ${region.name} - Coming Soon`,
      description: nextEvent
        ? `F3 ${region.name} is a registered region. Next up: ${nextEvent.title} on ${formatEventDate(
            nextEvent.date
          )}.`
        : `F3 ${region.name} is a registered region. Check back for upcoming workout schedules or visit our website to get involved.`,
    };
  }
  const nextEvent = upcomingEvents[0];
  const regionName = region.name;
  const regionCity = region.city;
  const regionState = region.state;
  const locations = regionData
    .map((workout) => workout.location)
    .filter(Boolean);
  const uniqueLocations = [...new Set(locations)];
  const hasLocations = uniqueLocations.length > 0;
  const locationString = hasLocations
    ? uniqueLocations.slice(0, 3).join(', ') +
      (uniqueLocations.length > 3 ? ', and more' : '')
    : '';
  const titleSuffix =
    regionCity && regionState ? ` (${regionCity}, ${regionState})` : '';
  const baseLocation =
    regionCity && regionState ? `${regionCity}, ${regionState}` : regionName;
  const workoutsDescription = `Find F3 workouts in ${baseLocation}${
    hasLocations ? `, serving ${locationString}` : ''
  }. Join us for free, peer-led workouts in your area.`;
  return {
    title: `F3 ${regionName} Workouts${titleSuffix}`,
    description: nextEvent
      ? `${workoutsDescription} Next up: ${nextEvent.title} on ${formatEventDate(
          nextEvent.date
        )}.`
      : workoutsDescription,
  };
}

export default async function RegionPage({
  params,
}: Pick<RegionProps, 'params'>) {
  const { regionSlug } = await params;
  const region = await fetchRegionBySlug(regionSlug);
  if (!region) {
    notFound();
  }
  const regionData = await fetchWorkoutLocationsByRegion(regionSlug);

  if (regionData[0].id === 'no-workouts') {
    return <OrphanedRegionContent region={region} />;
  }

  const upcomingEvents = getUpcomingRegionEvents(regionSlug, { limit: 3 });
  const regionName = regionData[0].region.name;
  const website = regionData[0].region.website || undefined;
  const email = regionData[0].region.email || undefined;
  const facebook = regionData[0].region.facebook || undefined;
  const twitter = regionData[0].region.twitter || undefined;
  const instagram = regionData[0].region.instagram || undefined;
  const image = regionData[0].region.image || undefined;
  const mapParams = calculateMapParameters(
    regionData.map((workout) => ({
      latitude: workout.latitude,
      longitude: workout.longitude,
      name: workout.name,
    }))
  );

  return (
    <RegionContent
      regionSlug={regionSlug}
      regionName={regionName}
      regionDescription={region.description}
      website={website}
      email={email}
      facebook={facebook}
      twitter={twitter}
      instagram={instagram}
      image={image}
      sortedWorkouts={sortWorkoutsByDayAndTime(regionData)}
      mapParams={mapParams}
      upcomingEvents={upcomingEvents}
    />
  );
}
