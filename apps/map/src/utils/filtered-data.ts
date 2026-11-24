// filteredData.ts

import type { DayOfWeek } from "@acme/shared/app/enums";
import { START_END_TIME_DB_FORMAT } from "@acme/shared/app/constants";
import { isTruthy } from "@acme/shared/common/functions";

import type { FiltersType } from "./store/filter";
import { dayjs } from "./frontendDayjs";
import { TimeSelection } from "./store/filter";

/**
 * The days the day filters allow, empty when none is set. "This weekend" adds
 * Saturday and Sunday to whatever days are picked.
 */
export const selectedDaysOfWeek = (filters: FiltersType): Set<DayOfWeek> => {
  const days = new Set<DayOfWeek>();
  if (filters.daySu || filters.weekend) days.add("sunday");
  if (filters.dayM) days.add("monday");
  if (filters.dayTu) days.add("tuesday");
  if (filters.dayW) days.add("wednesday");
  if (filters.dayTh) days.add("thursday");
  if (filters.dayF) days.add("friday");
  if (filters.daySa || filters.weekend) days.add("saturday");
  return days;
};

export const filterData = <
  T extends {
    events: {
      dayOfWeek: DayOfWeek | null;
      startTime: string | null;
      eventTypes: { id: number; name: string }[];
    }[];
  },
>(
  allLocationMarkers: T[],
  filters: FiltersType,
): T[] => {
  const days = selectedDaysOfWeek(filters);
  const filteredLocationMarkers = allLocationMarkers.map((locationMarker) => {
    const filteredEvents = locationMarker.events.filter((event) => {
      // No day filter means every day; otherwise the event's day must be one
      // of the picked days (or Saturday/Sunday for "This weekend").
      const includeThisLocationMarkerOnDays =
        days.size === 0 ||
        (event.dayOfWeek != null && days.has(event.dayOfWeek));

      const startDayjs = dayjs(event.startTime, START_END_TIME_DB_FORMAT);
      const startIsAM = startDayjs.format("a") === "am";
      const includeThisLocationMarkerOnAmPm =
        (!filters.am || startIsAM) && (!filters.pm || !startIsAM);

      const selectedTypeIds = filters.nationalEventTypeIds;
      const typeFilterActive = selectedTypeIds.length > 0;
      const includeThisLocationMarkerOnType =
        !typeFilterActive ||
        event.eventTypes.some((type) => selectedTypeIds.includes(type.id));

      // // Check if the after time filter matches the station's end time
      let includeThisLocationMarkerOnTime = true;
      if (filters.beforeAfterTime !== TimeSelection.none) {
        const hour = filters.beforeAfterTime.slice(0, -2);
        const period = filters.beforeAfterTime.slice(-2);
        let filterTime = parseInt(hour, 10);
        const stationStartTime = parseInt(
          event.startTime?.slice(0, 2) ?? "0",
          10,
        );

        if (period === "pm" && filterTime !== 12) {
          filterTime += 12;
        }

        if (
          filters.beforeAfterDirection === "before"
            ? stationStartTime > filterTime
            : stationStartTime < filterTime
        ) {
          includeThisLocationMarkerOnTime = false;
        }
      }

      return (
        includeThisLocationMarkerOnDays &&
        includeThisLocationMarkerOnAmPm &&
        includeThisLocationMarkerOnType &&
        includeThisLocationMarkerOnTime
      );
    });

    return filteredEvents.length === 0
      ? null
      : {
          ...locationMarker,
          events: filteredEvents,
        };
  });

  return filteredLocationMarkers.filter(isTruthy);
};
