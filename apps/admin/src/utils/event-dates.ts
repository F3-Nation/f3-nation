/**
 * Formats an ISO date string for table display, or "" when absent — the
 * shared pattern behind the workouts table's Start/End Date columns.
 */
export function formatDateOrEmpty(date: string | null | undefined): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  return year && month && day
    ? new Date(year, month - 1, day).toLocaleDateString()
    : new Date(date).toLocaleDateString();
}

/**
 * True when an end date is set and falls before the start date. Both are
 * "YYYY-MM-DD" strings, so a lexicographic comparison is correct without
 * parsing.
 */
export function isEndDateBeforeStartDate(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): boolean {
  return !!(endDate && startDate && endDate < startDate);
}
