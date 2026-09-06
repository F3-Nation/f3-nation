import { convertHH_mmToHHmm } from "@acme/shared/app/functions";

/**
 * Converts a form time input (`"HH:mm"` or `""`) to the format expected by the API.
 * Empty or incomplete values are mapped to `null` to clear the stored time.
 */
export const toStoredTime = (
  value: string | null | undefined,
): string | null => (value?.length === 5 ? convertHH_mmToHHmm(value) : null);
