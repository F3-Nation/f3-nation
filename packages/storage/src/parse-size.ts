/**
 * Parse the optional `size` form field used by the upload-logo/avatar routes.
 * Returns `undefined` when absent, the parsed positive number, or the literal
 * `"invalid"` so callers can return a 400 without throwing.
 */
export function parseOptionalSize(
  sizeRaw: FormDataEntryValue | null,
): number | undefined | "invalid" {
  if (!sizeRaw) return undefined;
  const parsed = Number(sizeRaw);
  if (!Number.isInteger(parsed) || parsed <= 0) return "invalid";
  return parsed;
}
