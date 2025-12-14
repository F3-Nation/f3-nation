import dayjs from "dayjs";

import type { DayOfWeek } from "@acme/shared/app/enums";
import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { getReadableDayOfWeek } from "@acme/shared/app/functions";

export const getWhenFromWorkout = (params: {
  startTime: string | null;
  endTime?: string | null;
  dayOfWeek: DayOfWeek | null;
  condensed?: boolean;
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

  const dayOfTheWeekText = dayOfTheWeek ? `${dayOfTheWeek} ` : "";
  const timeText =
    startTime && endTime
      ? `${startTime} - ${endTime} `
      : startTime
        ? `${startTime} `
        : "";
  const durationText = duration ? `(${duration}min)` : "";

  return `${dayOfTheWeekText}${timeText}${durationText}`.trim();
};
