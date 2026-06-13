// filteredData.ts

import type { DayOfWeek } from "@acme/shared/app/enums";
import { START_END_TIME_DB_FORMAT } from "@acme/shared/app/constants";
import { isTruthy } from "@acme/shared/common/functions";

import type { FiltersType } from "./store/filter";
import { dayjs } from "./frontendDayjs";
import { TimeSelection } from "./store/filter";

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
  const filteredLocationMarkers = allLocationMarkers.map((locationMarker) => {
    const filteredEvents = locationMarker.events.filter((event) => {
      // Check if at least one of the selected day filters matches the station's day

      const noDayFilters = [
        filters.daySu,
        filters.dayM,
        filters.dayTu,
        filters.dayW,
        filters.dayTh,
        filters.dayF,
        filters.daySa,
        // filters.todayVar,
        // filters.tomorrowVar,
      ].every((f) => f === false);

      const specificDayFilterMatch = [
        filters.daySu && event.dayOfWeek === "sunday",
        filters.dayM && event.dayOfWeek === "monday",
        filters.dayTu && event.dayOfWeek === "tuesday",
        filters.dayW && event.dayOfWeek === "wednesday",
        filters.dayTh && event.dayOfWeek === "thursday",
        filters.dayF && event.dayOfWeek === "friday",
        filters.daySa && event.dayOfWeek === "saturday",
        // filters.today && event.dayOfWeek === currentDay,
        // filters.tomorrow && event.dayOfWeek === getNextDay(currentDay),
      ].some((f) => f === true);

      const includeThisLocationMarkerOnDays =
        noDayFilters || specificDayFilterMatch;

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
        let filterTime = parseInt(hour ?? "0", 10);
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
