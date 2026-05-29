import { getDomain } from "tldts";
import { z } from "zod";

// Static IP of the redirect tier (apex A-records point here). Overridable so
// the value isn't hardcoded across environments.
export const STATIC_IP = process.env.REDIRECT_STATIC_IP ?? "34.172.36.60";

// Canonical host that subdomains CNAME to (it A-records to STATIC_IP). Like
// Vercel's cname.vercel-dns.com — lets a tenant bring just a subdomain with a
// single CNAME and no A record, without touching their apex. Configurable per
// environment.
export const CANONICAL_HOST = process.env.REDIRECT_CANONICAL_HOST ?? "";

/** Lower-case, trim, strip a trailing dot and any port. */
export function normalizeHost(host: string): string {
  host = host.trim().toLowerCase().replace(/\.$/, "");
  const colon = host.indexOf(":");
  return colon >= 0 ? host.slice(0, colon) : host;
}

/** True if host is a registrable apex (equals its own eTLD+1). */
export function isApex(host: string): boolean {
  host = normalizeHost(host);
  const reg = getDomain(host);
  return reg !== null && reg === host;
}

/** Registrable (eTLD+1) domain for host, e.g. stats.x.com -> x.com. */
export function apexOf(host: string): string {
  return getDomain(normalizeHost(host)) ?? normalizeHost(host);
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const destinationField = z
  .string()
  .trim()
  .min(1, "destination URL is required")
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an absolute http(s) URL");

export const registerSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1, "hostname is required")
    .transform(normalizeHost)
    .refine(
      (h) => HOSTNAME_RE.test(h),
      "must be a valid fully-qualified domain (e.g. example.com)",
    )
    // HOSTNAME_RE accepts bare public suffixes like "co.uk", which are not
    // registrable and would later yield impossible DNS instructions. Require a
    // registrable (eTLD+1) domain.
    .refine(
      (h) => getDomain(h) !== null,
      "must be a registrable domain, not a public suffix",
    ),
  destination: destinationField,
});

// Editing a redirect only changes the destination; the hostname is immutable
// (changing it is a different registration).
export const updateSchema = z.object({ destination: destinationField });

export interface DnsRecord {
  type: "A" | "CNAME";
  name: string;
  value: string;
  note: string;
  // false = required to activate the redirect; true = recommended extra.
  optional: boolean;
}

export interface DnsOptions {
  staticIP?: string;
  canonicalHost?: string;
}

/**
 * DNS record(s) a tenant must create to activate a redirect.
 * - apex domains cannot CNAME → A record to the static IP
 * - subdomains → a single CNAME to the canonical host (which A-records to the
 *   static IP). No apex A record is required, and the tenant's apex is left
 *   untouched. If no canonical host is configured, fall back to CNAME-to-apex.
 */
export function dnsInstructions(
  hostname: string,
  opts: DnsOptions = {},
): DnsRecord[] {
  const host = normalizeHost(hostname);
  const staticIP = opts.staticIP ?? STATIC_IP;
  const canonicalHost = opts.canonicalHost ?? CANONICAL_HOST;

  if (isApex(host)) {
    // Required: the apex itself via an A record (apex can't CNAME). Recommended
    // extra: also redirect the www subdomain, pointed at the apex.
    return [
      {
        type: "A",
        name: host,
        value: staticIP,
        note: `Required: ${host} is an apex domain and cannot use a CNAME, so point an A record at the redirect tier's static IP.`,
        optional: false,
      },
      {
        type: "CNAME",
        name: `www.${host}`,
        value: host,
        note: `Recommended: so www.${host} redirects too. Point it at ${host} (which carries the A record above).`,
        optional: true,
      },
    ];
  }

  if (canonicalHost) {
    return [
      {
        type: "CNAME",
        name: host,
        value: canonicalHost,
        note: `Required: ${host} is a subdomain; add a single CNAME to ${canonicalHost}. No A record is needed.`,
        optional: false,
      },
    ];
  }

  const apex = apexOf(host);
  return [
    {
      type: "CNAME",
      name: host,
      value: apex,
      note: `Required: ${host} is a subdomain; CNAME it to ${apex} (which must carry an A record to ${staticIP}).`,
      optional: false,
    },
  ];
}
