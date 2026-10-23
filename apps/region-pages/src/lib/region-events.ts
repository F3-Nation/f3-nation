import kebabCase from "lodash/kebabCase";
import regionEventsData from "@/data/region-events.json";
import type { RegionEventsEntry, RegionEvent } from "@/types/event";

const regionEvents = regionEventsData as RegionEventsEntry[];

// Event dates are calendar days. A day counts as over only once it has ended
// everywhere ("anywhere on Earth", UTC-12), so an event stays upcoming through
// its whole date in every region and the result never depends on the
// server's timezone.
const AOE_OFFSET_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const currentDayKey = (referenceDate: Date, daysBack = 0): string =>
  new Date(referenceDate.getTime() - AOE_OFFSET_MS - daysBack * DAY_MS)
    .toISOString()
    .slice(0, 10);

const eventDayKey = (event: RegionEvent): string | null =>
  DATE_KEY.test(event.date) ? event.date : null;

const timeSortKey = (time?: string): string => {
  const [hours = "0", minutes = "0"] = (time ?? "").split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
};

const extractEventIdFromSlug = (slug: string): string | null => {
  if (!slug) {
    return null;
  }

  const match = /^[0-9a-fA-F]{6,64}/.exec(slug);
  return match ? match[0].toLowerCase() : null;
};

const getEventSlugSuffix = (event: RegionEvent): string => {
  if (event.slugSuffix && event.slugSuffix.trim().length > 0) {
    return kebabCase(event.slugSuffix);
  }

  if (event.title && event.title.trim().length > 0) {
    return kebabCase(event.title);
  }

  return "";
};

export const buildEventSlug = (event: RegionEvent): string => {
  const suffix = getEventSlugSuffix(event);
  return suffix ? `${event.id}-${suffix}` : event.id;
};

const findRegionEventsEntry = (
  regionSlug: string,
): RegionEventsEntry | undefined =>
  regionEvents.find((entry) => entry.regionSlug === regionSlug);

export const findRegionEvent = (
  regionSlug: string,
  eventSlug: string,
): { region: RegionEventsEntry; event: RegionEvent } | null => {
  const region = findRegionEventsEntry(regionSlug);
  if (!region) {
    return null;
  }

  const candidateId = extractEventIdFromSlug(eventSlug);
  if (candidateId) {
    const directMatch = region.events.find(
      (item) => item.id.toLowerCase() === candidateId,
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
  } = {},
): RegionEvent[] => {
  const region = findRegionEventsEntry(regionSlug);
  if (!region) {
    return [];
  }

  const earliestDay = currentDayKey(
    referenceDate,
    Math.max(includePastDays, 0),
  );

  const upcoming = region.events
    .filter((event) => {
      const day = eventDayKey(event);
      return day !== null && day >= earliestDay;
    })
    .sort((a, b) =>
      `${a.date} ${timeSortKey(a.startTime)}`.localeCompare(
        `${b.date} ${timeSortKey(b.startTime)}`,
      ),
    );

  return typeof limit === "number" ? upcoming.slice(0, limit) : upcoming;
};

export const getAllEventStaticParams = (): {
  regionSlug: string;
  eventSlug: string;
}[] =>
  regionEvents.flatMap((region) =>
    region.events.map((event) => ({
      regionSlug: region.regionSlug,
      eventSlug: buildEventSlug(event),
    })),
  );

export const hasEventEnded = (
  event: RegionEvent,
  referenceDate: Date = new Date(),
): boolean => {
  const day = eventDayKey(event);
  return day !== null && day < currentDayKey(referenceDate);
};

export const formatEventDate = (date: string, locale = "en-US"): string => {
  const instant = new Date(`${date}T12:00:00Z`);
  // An empty or malformed date would make Intl throw a RangeError.
  if (!date || Number.isNaN(instant.valueOf())) return "Date TBD";
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    // Dates are calendar days; format the noon-UTC instant in UTC so no
    // viewer timezone (e.g. UTC+13) shifts it to a neighbouring day.
    timeZone: "UTC",
  });

  return formatter.format(instant);
};

export const formatEventTime = (time?: string): string | undefined => {
  if (!time) return undefined;

  const [hoursString, minutesString = "00"] = time.split(":");
  const hours = Number.parseInt(hoursString ?? "", 10);
  const minutes = Number.parseInt(minutesString, 10);

  if (Number.isNaN(hours) || hours < 0 || hours > 23) return time;
  if (Number.isNaN(minutes) || minutes < 0 || minutes > 59) return time;

  const period = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 || 12;

  return `${normalizedHours}:${minutes.toString().padStart(2, "0")} ${period}`;
};

export const formatEventTimeRange = (
  startTime?: string,
  endTime?: string,
): string | undefined => {
  const formattedStart = formatEventTime(startTime);
  const formattedEnd = formatEventTime(endTime);

  if (formattedStart && formattedEnd) {
    return `${formattedStart} – ${formattedEnd}`;
  }
  return formattedStart ?? formattedEnd;
};
