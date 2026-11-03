// @ts-check
// Baseline HTTP security response headers shared by every F3 web app and the API.
//
// Plain JS (with JSDoc types) on purpose: `next.config.js` in apps/auth,
// apps/admin and apps/map is loaded by Node before any TypeScript tooling runs,
// so it cannot import a `.ts` workspace package.
//
// Deliberately NOT here: a full Content-Security-Policy. Google Maps, PostHog,
// Sentry, Google Analytics and GCS-hosted images all need allow-listing, Next's
// inline bootstrap scripts need nonces, and an enforced policy that is wrong
// breaks the map for every user. Ship it as a Report-Only follow-up once there
// is somewhere to collect the reports. The one directive that is safe to enforce
// today is `frame-ancestors`, which only controls who may embed the page.

/**
 * One year, no `includeSubDomains`, no `preload`: both are hard to undo and the
 * f3nation.com subdomains are not all owned by these apps. Every origin that
 * sends this must stay HTTPS-only (Cloud Run terminates TLS today); a one-year
 * max-age is hard to take back if a plain-HTTP listener is ever added.
 */
export const HSTS_VALUE = "max-age=31536000";

/**
 * @typedef {object} SecurityHeadersOptions
 * @property {"deny" | "embeddable"} frame
 *   `deny` forbids any framing (clickjacking protection). `embeddable` sends no
 *   framing header at all, for apps that are intentionally iframed (the map).
 * @property {boolean} [geolocation]
 *   Allow the Geolocation API for the app's own origin. Off everywhere else.
 */

/**
 * @param {SecurityHeadersOptions} options
 * @returns {{ key: string; value: string }[]}
 */
export function securityHeaders({ frame, geolocation = false }) {
  /** @type {{ key: string; value: string }[]} */
  const headers = [
    { key: "Strict-Transport-Security", value: HSTS_VALUE },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // `usb=()` only gates the WebUSB API. WebAuthn/passkeys are a separate
      // feature and are unaffected (the auth app has no passkey flow today).
      value: [
        "camera=()",
        "microphone=()",
        "payment=()",
        "usb=()",
        `geolocation=${geolocation ? "(self)" : "()"}`,
      ].join(", "),
    },
  ];
  if (frame === "deny") {
    headers.push(
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    );
  }
  return headers;
}

/**
 * Value for Next's `headers` config option: applies to every route, including
 * static assets and API routes.
 *
 * @param {SecurityHeadersOptions} options
 * @returns {() => Promise<{ source: string; headers: { key: string; value: string }[] }[]>}
 */
export function nextSecurityHeaders(options) {
  const headers = securityHeaders(options);
  return () => Promise.resolve([{ source: "/:path*", headers }]);
}

/**
 * The same headers as a plain record, for non-Next servers (the Hono API).
 *
 * @param {SecurityHeadersOptions} options
 * @returns {Record<string, string>}
 */
export function securityHeadersRecord(options) {
  return Object.fromEntries(
    securityHeaders(options).map((h) => [h.key, h.value]),
  );
}
