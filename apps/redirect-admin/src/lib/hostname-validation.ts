/**
 * Plausible-domain check for user-supplied hostnames on the registration
 * form. Deliberately strict (ASCII only, DNS label rules), but leaves the
 * final reservation/blocklist call to the DB.
 *
 * Pure — no I/O. Unit-testable in isolation.
 */

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type HostnameValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: HostnameValidationError };

export type HostnameValidationError =
  | "empty"
  | "too_long"
  | "contains_scheme"
  | "contains_path_or_query"
  | "too_few_labels"
  | "label_invalid";

const MAX_FQDN_LENGTH = 253;

export function validateHostname(
  raw: string | null | undefined,
): HostnameValidationResult {
  if (!raw) return { valid: false, reason: "empty" };
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { valid: false, reason: "empty" };

  if (trimmed.length > MAX_FQDN_LENGTH) {
    return { valid: false, reason: "too_long" };
  }

  if (/^https?:\/\//.test(trimmed) || trimmed.includes("://")) {
    return { valid: false, reason: "contains_scheme" };
  }
  if (/[/?#]/.test(trimmed)) {
    return { valid: false, reason: "contains_path_or_query" };
  }

  // Strip trailing dot (FQDN form) for label checks.
  const hostname = trimmed.replace(/\.$/, "");

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return { valid: false, reason: "too_few_labels" };
  }
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      return { valid: false, reason: "label_invalid" };
    }
  }

  return { valid: true, normalized: hostname };
}
