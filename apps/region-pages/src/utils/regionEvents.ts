import kebabCase from 'lodash/kebabCase';
import regionEventsData from '@/data/region-events.json';
import type { RegionEventsEntry, RegionEvent } from '@/types/Event';

const regionEvents = regionEventsData as RegionEventsEntry[];

const startOfDay = (value: Date): Date => {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const toComparableDate = (event: RegionEvent): Date => {
  if (!event.date) {
    return new Date(0);
  }

  const dateString = `${event.date}T${event.startTime ?? '00:00'}:00`;
  const result = new Date(dateString);

  // Fallback in case the combined string is invalid (e.g., missing month)
  if (Number.isNaN(result.valueOf())) {
    return new Date(event.date);
  }

  return result;
};

const extractEventIdFromSlug = (slug: string): string | null => {
  if (!slug) {
    return null;
  }

  const match = slug.match(/^[0-9a-fA-F]{6,64}/);
  return match ? match[0].toLowerCase() : null;
};

const getEventSlugSuffix = (event: RegionEvent): string => {
  if (event.slugSuffix && event.slugSuffix.trim().length > 0) {
    return kebabCase(event.slugSuffix);
  }

  if (event.title && event.title.trim().length > 0) {
    return kebabCase(event.title);
  }

  return '';
};

export const buildEventSlug = (event: RegionEvent): string => {
  const suffix = getEventSlugSuffix(event);
  return suffix ? `${event.id}-${suffix}` : event.id;
};

export const getAllRegionEvents = (): RegionEventsEntry[] => regionEvents;

export const findRegionEventsEntry = (
  regionSlug: string
): RegionEventsEntry | undefined =>
  regionEvents.find((entry) => entry.regionSlug === regionSlug);

export const findRegionEvent = (
  regionSlug: string,
  eventSlug: string
): { region: RegionEventsEntry; event: RegionEvent } | null => {
  const region = findRegionEventsEntry(regionSlug);
  if (!region) {
    return null;
  }

  const candidateId = extractEventIdFromSlug(eventSlug);
  if (candidateId) {
    const directMatch = region.events.find(
      (item) => item.id.toLowerCase() === candidateId
    );
    if (directMatch) {
      return { region, event: directMatch };
    }
  }

  const fallbackMatch = region.events.find((item) => {
    const explicitSlug = (item as unknown as { eventSlug?: string }).eventSlug;
    if (explicitSlug && explicitSlug === eventSlug) {
      return true;
    }
    if (item.legacySlugs?.includes(eventSlug)) {
      return true;
    }
    return buildEventSlug(item) === eventSlug;
  });

  return fallbackMatch ? { region, event: fallbackMatch } : null;
};

export const getUpcomingRegionEvents = (
  regionSlug: string,
  {
    referenceDate = new Date(),
    limit,
    includePastDays = 0,
  }: {
    referenceDate?: Date;
    limit?: number;
    includePastDays?: number;
  } = {}
): RegionEvent[] => {
  const region = findRegionEventsEntry(regionSlug);
  if (!region) {
    return [];
  }

  const comparisonDate = startOfDay(referenceDate);
  if (includePastDays > 0) {
    comparisonDate.setDate(comparisonDate.getDate() - includePastDays);
  }

  const upcoming = region.events
    .filter((event) => {
      if (!event.date) {
        return false;
      }
      const eventDate = startOfDay(toComparableDate(event));
      return eventDate >= comparisonDate;
    })
    .sort(
      (a, b) => toComparableDate(a).getTime() - toComparableDate(b).getTime()
    );

  return typeof limit === 'number' ? upcoming.slice(0, limit) : upcoming;
};

export const getAllEventStaticParams = (): {
  regionSlug: string;
  eventSlug: string;
}[] =>
  regionEvents.flatMap((region) =>
    region.events.map((event) => ({
      regionSlug: region.regionSlug,
      eventSlug: buildEventSlug(event),
    }))
  );

export const hasEventEnded = (
  event: RegionEvent,
  referenceDate: Date = new Date()
): boolean => {
  if (!event.date) {
    return false;
  }

  const eventDate = startOfDay(toComparableDate(event));
  const comparisonDate = startOfDay(referenceDate);

  return eventDate < comparisonDate;
};

export const formatEventDate = (
  date: string,
  locale: string = 'en-US'
): string => {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return formatter.format(new Date(`${date}T12:00:00Z`));
};

export const formatEventTime = (time?: string): string | undefined => {
  if (!time) return undefined;

  const [hoursString, minutesString = '00'] = time.split(':');
  const hours = Number.parseInt(hoursString, 10);
  const minutes = Number.parseInt(minutesString, 10);

  if (Number.isNaN(hours) || hours < 0 || hours > 23) return time;
  if (Number.isNaN(minutes) || minutes < 0 || minutes > 59) return time;

  const period = hours >= 12 ? 'PM' : 'AM';
  const normalizedHours = hours % 12 || 12;

  return `${normalizedHours}:${minutes.toString().padStart(2, '0')} ${period}`;
};

export const formatEventTimeRange = (
  startTime?: string,
  endTime?: string
): string | undefined => {
  const formattedStart = formatEventTime(startTime);
  const formattedEnd = formatEventTime(endTime);

  if (!formattedStart && !formattedEnd) return undefined;

  const baseRange = formattedEnd
    ? `${formattedStart ?? ''} – ${formattedEnd}`
    : formattedStart ?? formattedEnd;

  return baseRange || undefined;
};
