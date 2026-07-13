import dayjs from "dayjs";

import type { DayOfWeek } from "@acme/shared/app/enums";
import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { getReadableDayOfWeek } from "@acme/shared/app/functions";

const ORDINALS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
};

export const getWhenFromWorkout = (params: {
  startTime: string | null;
  endTime?: string | null;
  dayOfWeek: DayOfWeek | null;
  condensed?: boolean;
  recurrencePattern?: string | null;
  recurrenceInterval?: number | null;
  indexWithinInterval?: number | null;
}) => {
  const event = params;
  const condensed = params.condensed ?? false;
  const startTimeRaw = !event.startTime
    ? undefined
    : dayjs(event.startTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      );

  const endTimeRaw = !event.endTime
    ? undefined
    : dayjs(event.endTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      );

  const startTime = !condensed
    ? startTimeRaw
    : startTimeRaw?.replace(":00", "");

  const endTime = !condensed ? endTimeRaw : endTimeRaw?.replace(":00", "");

  const duration =
    event.endTime && event.startTime
      ? dayjs(event.endTime, START_END_TIME_DB_FORMAT).diff(
          dayjs(event.startTime, START_END_TIME_DB_FORMAT),
          "minutes",
        )
      : null;

  const dayOfTheWeek = getReadableDayOfWeek(event.dayOfWeek);

  const ordinalPrefix =
    event.recurrencePattern === "monthly"
      ? event.indexWithinInterval
        ? `${ORDINALS[event.indexWithinInterval] ?? event.indexWithinInterval} `
        : "Monthly on "
      : "";

  const intervalPrefix =
    event.recurrencePattern === "weekly" &&
    event.recurrenceInterval &&
    event.recurrenceInterval > 1
      ? event.recurrenceInterval === 2
        ? "Every other "
        : `Every ${event.recurrenceInterval} weeks on `
      : "";

  const monthlyIntervalPrefix =
    event.recurrencePattern === "monthly" &&
    event.recurrenceInterval &&
    event.recurrenceInterval > 1
      ? event.recurrenceInterval === 2
        ? "Every other month on "
        : `Every ${event.recurrenceInterval} months on `
      : "";

  const dayOfTheWeekText = dayOfTheWeek
    ? `${monthlyIntervalPrefix}${ordinalPrefix}${intervalPrefix}${dayOfTheWeek} `
    : "";
  const timeText =
    startTime && endTime
      ? `${startTime} - ${endTime} `
      : startTime
        ? `${startTime} `
        : "";
  const durationText = duration ? `(${duration}min)` : "";

  return `${dayOfTheWeekText}${timeText}${durationText}`.trim();
};
