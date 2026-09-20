import { dayjs } from "./frontendDayjs";

export const getEndDateLabel = (
  endDate: string | null | undefined,
): string | null => {
  if (!endDate) return null;
  const parsed = dayjs(endDate, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return null;

  if (parsed.isToday()) return "Ends Today";
  if (parsed.isBefore(dayjs(), "day")) {
    return `Ended ${parsed.format("MMM D, YYYY")}`;
  }
  return `Through ${parsed.format("MMM D, YYYY")}`;
};
