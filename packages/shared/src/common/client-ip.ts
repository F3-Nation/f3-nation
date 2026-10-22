/**
 * Number of proxies in front of our services that append to
 * `X-Forwarded-For`.
 *
 * Every app runs on Google Cloud Run. Google's front end *appends* the IP of
 * the connection it accepted to whatever `X-Forwarded-For` the caller sent, so
 * a request sent with `X-Forwarded-For: 9.9.9.9` arrives as
 * `9.9.9.9, <real client IP>`. Everything left of the entries our own
 * infrastructure appended is caller-controlled: keying a rate limiter on the
 * leftmost entry lets a caller mint a fresh bucket per request just by
 * changing the header (#359).
 *
 * With Cloud Run alone exactly one entry is ours (the rightmost). If a service
 * is ever put behind a Google HTTPS load balancer, that load balancer appends
 * `<client IP>, <load balancer IP>`, so it would need 2 here.
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * The client IP as seen by the nearest untrusted hop: the entry
 * `trustedHops` from the right of `X-Forwarded-For`, which our proxies wrote
 * and the caller cannot forge.
 *
 * Parsing rules (pinned by tests):
 * - Entries are trimmed and empty ones dropped, so this returns the rightmost
 *   non-empty entry, not the literal last comma-separated token. A header with
 *   no usable entry (`""`, `", "`) is treated like an absent one.
 * - `trustedHops` is floored at 1: 0 or a negative count still reads the
 *   rightmost entry. There is no "trust nothing" mode; a caller that does not
 *   sit behind a proxy should not call this.
 * - A header shorter than `trustedHops` means the request skipped some of the
 *   expected proxies; every entry in it was still appended by one of them, so
 *   the leftmost is used.
 *
 * Returns null when there is no usable `X-Forwarded-For` (local dev, tests),
 * so each caller picks its own fallback.
 */
export function getTrustedClientIp(
  headers: Pick<Headers, "get"> | null | undefined,
  trustedHops: number = TRUSTED_PROXY_HOPS,
): string | null {
  const entries = (headers?.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return (
    entries[Math.max(0, entries.length - Math.max(1, trustedHops))] ?? null
  );
}
