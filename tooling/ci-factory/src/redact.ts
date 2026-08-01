/**
 * Mask a secret for display (error messages, logs) — never the full value.
 * Short enough that a partial reveal would still be exploitable: mask
 * entirely. Otherwise show a few characters at each end so a human can tell
 * *which* key is loaded without the value being reconstructible.
 */
export function redactSecret(value: string | undefined): string {
  if (!value) return "(unset)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
