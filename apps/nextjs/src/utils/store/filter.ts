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
  Bootcamp: false,
  Ruck: false,
  Swim: false,
  Run: false,
  beforeAfterDirection: "before" as "before" | "after",
  beforeAfterTime: TimeSelection.none,
  CSAUPs: false,
  Convergence: false,
  GTE: false,
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
  const { am: _am, pm: _pm, beforeAfterTime, ...otherFilters } = filters;
  return (
    Object.values(otherFilters).some((value) => value === true) ||
    beforeAfterTime !== TimeSelection.none
  );
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

  const todayVar = NUMBER_TO_DAY_KEY[dayNumber] ?? "dayM";
  const tomorrowVar = NUMBER_TO_DAY_KEY[(dayNumber + 1) % 7] ?? "dayTu";

  return { today, tomorrow, todayVar, tomorrowVar };
};
