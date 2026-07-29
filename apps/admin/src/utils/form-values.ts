import { convertHH_mmToHHmm } from "@acme/shared/app/functions";

/**
 * Map a form time field (`<input type="time">`, so `"HH:mm"` or `""`) to the
 * value the API expects.
 *
 * An emptied input must become an explicit `null` so the stored time is
 * removed. Returning `undefined` would drop the key from the request body, and
 * Drizzle omits undefined keys from the SET clause — leaving the old time in
 * place, which reads as "clearing the field silently did nothing".
 *
 * `convertHH_mmToHHmm` returns `""` for anything that isn't 5 characters, so
 * the length check has to stay: without it a half-typed value would persist an
 * empty string instead of null.
 */
export const toStoredTime = (
  value: string | null | undefined,
): string | null => (value?.length === 5 ? convertHH_mmToHHmm(value) : null);
