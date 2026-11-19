import dayjs from "dayjs";

import { ZustandStore } from "@acme/shared/common/classes";

export enum TimeSelection {
  none = "none",
  "12am" = "12am",
  "1am" = "1am",
  "2am" = "2am",
  "3am" = "3am",
  "4am" = "4am",
  "5am" = "5am",
  "6am" = "6am",
  "7am" = "7am",
  "8am" = "8am",
  "9am" = "9am",
  "10am" = "10am",
  "11am" = "11am",
  "12pm" = "12pm",
  "1pm" = "1pm",
  "2pm" = "2pm",
  "3pm" = "3pm",
  "4pm" = "4pm",
  "5pm" = "5pm",
  "6pm" = "6pm",
  "7pm" = "7pm",
  "8pm" = "8pm",
  "9pm" = "9pm",
  "10pm" = "10pm",
  "11pm" = "11pm",
}

export const initialFilterState = {
  // today: false,
  // tomorrow: false,
  am: false,
  pm: false,
  allFilters: false,
  daySu: false,
  dayM: false,
  dayTu: false,
  dayW: false,
  dayTh: false,
  dayF: false,
  daySa: false,
  /** "This weekend" quick pick: adds Saturday and Sunday to the day filter. */
  weekend: false,
  /** National event type IDs; empty means no type filter (show all). */
  nationalEventTypeIds: [] as number[],
  beforeAfterDirection: "before" as "before" | "after",
  beforeAfterTime: TimeSelection.none,
  position: { latitude: 0, longitude: 0 },
};

export type FiltersType = typeof initialFilterState;

export const filterStore = new ZustandStore({
  initialState: initialFilterState,
  persistOptions: {
    name: "filter-store",
    version: 1,
    persistedKeys: [],
    getStorage: () => localStorage,
  },
});

export const isAnyFilterActive = (filters: FiltersType) => {
  const {
    am: _am,
    pm: _pm,
    beforeAfterTime,
    nationalEventTypeIds,
    ...otherFilters
  } = filters;
  return (
    nationalEventTypeIds.length > 0 ||
    Object.values(otherFilters).some((value) => value === true) ||
    beforeAfterTime !== TimeSelection.none
  );
};

/**
 * How many filter groups are narrowing the map — days (including a quick
 * pick), time of day, and type — for the count on the Filters button.
 */
export const activeFilterCount = (filters: FiltersType) => {
  const days =
    filters.weekend ||
    [
      filters.daySu,
      filters.dayM,
      filters.dayTu,
      filters.dayW,
      filters.dayTh,
      filters.dayF,
      filters.daySa,
    ].some(Boolean);
  const time =
    filters.am || filters.pm || filters.beforeAfterTime !== TimeSelection.none;
  const type = filters.nationalEventTypeIds.length > 0;
  return [days, time, type].filter(Boolean).length;
};

const NUMBER_TO_DAY_KEY = [
  "daySu",
  "dayM",
  "dayTu",
  "dayW",
  "dayTh",
  "dayF",
  "daySa",
] as const;

export const useTodayAndTomorrowFilters = () => {
  const dayNumber = dayjs().day();
  const dayM = filterStore.use.dayM();
  const dayTu = filterStore.use.dayTu();
  const dayW = filterStore.use.dayW();
  const dayTh = filterStore.use.dayTh();
  const dayF = filterStore.use.dayF();
  const daySa = filterStore.use.daySa();
  const daySu = filterStore.use.daySu();
  const today =
    (dayNumber === 0 && daySu) ||
    (dayNumber === 1 && dayM) ||
    (dayNumber === 2 && dayTu) ||
    (dayNumber === 3 && dayW) ||
    (dayNumber === 4 && dayTh) ||
    (dayNumber === 5 && dayF) ||
    (dayNumber === 6 && daySa);

  const tomorrow =
    (dayNumber === 6 && daySu) ||
    (dayNumber === 0 && dayM) ||
    (dayNumber === 1 && dayTu) ||
    (dayNumber === 2 && dayW) ||
    (dayNumber === 3 && dayTh) ||
    (dayNumber === 4 && dayF) ||
    (dayNumber === 5 && daySa);

  const todayVar = NUMBER_TO_DAY_KEY[dayNumber];
  const tomorrowVar = NUMBER_TO_DAY_KEY[(dayNumber + 1) % 7] ?? "dayTu";

  return { today, tomorrow, todayVar, tomorrowVar };
};
