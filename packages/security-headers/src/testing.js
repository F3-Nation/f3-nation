// @ts-check
// Wiring check for a Next app's real config, shared by each app's
// `__tests__/next-config.test.ts`. The check runs in each app (not here) so
// that Turbo's affected-only CI reruns it whenever that app's config changes.
//
// Returns a list of problems instead of asserting, so this package stays free
// of a test-runner dependency and a test can `expect(problems).toEqual([])` to
// see every miss at once.

import { HSTS_VALUE } from "./index.js";

/** @param {string} value */
const hstsMaxAge = (value) =>
  Number(/^max-age=(\d+)(;|$)/.exec(value)?.[1] ?? -1);

const MIN_HSTS_MAX_AGE = hstsMaxAge(HSTS_VALUE);

/**
 * @typedef {object} NextConfigLike
 * @property {boolean} [poweredByHeader]
 * @property {() => Promise<{ source: string; has?: unknown[]; missing?: unknown[]; headers: { key: string; value: string }[] }[]>} [headers]
 */

/**
 * The value of a CSP's first `frame-ancestors` directive, the one browsers
 * enforce; a repeated directive is ignored.
 *
 * @param {string} csp
 */
const frameAncestors = (csp) =>
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === "frame-ancestors")
    ?.slice(1)
    .join(" ");

/**
 * Checks the baseline every app must meet, so an app may send a stricter
 * policy of its own (apps/region-pages sends a full CSP and a longer HSTS)
 * and still pass.
 *
 * @param {NextConfigLike} config
 * @param {import("./index.js").SecurityHeadersOptions} options
 *   The same options as `nextSecurityHeaders`: what the app is expected to send.
 * @returns {Promise<string[]>}
 */
export async function nextSecurityHeaderProblems(
  config,
  { frame, geolocation = false },
) {
  /** @type {string[]} */
  const problems = [];
  if (config.poweredByHeader !== false) {
    problems.push("poweredByHeader must be false");
  }

  const rules = (await config.headers?.()) ?? [];
  if (rules.length !== 1 || rules[0]?.source !== "/:path*") {
    problems.push("headers() must return exactly one rule for /:path*");
  }
  if (rules[0]?.has?.length || rules[0]?.missing?.length) {
    // Next would send the headers only to requests matching the condition.
    problems.push("the /:path* rule must not have has/missing conditions");
  }
  // Header names are case-insensitive and Next sets each with Node's
  // `setHeader`, so a later entry replaces an earlier one in any case.
  const h = new Map(
    (rules[0]?.headers ?? []).map((x) => [x.key.toLowerCase(), x.value]),
  );

  /**
   * @param {string} key
   * @param {(value: string) => boolean} ok
   * @param {string} expected
   */
  const want = (key, ok, expected) => {
    const value = h.get(key.toLowerCase());
    if (!ok(value ?? "")) {
      problems.push(`${key}: got ${JSON.stringify(value)}, want ${expected}`);
    }
  };
  want(
    "Strict-Transport-Security",
    (v) => hstsMaxAge(v) >= MIN_HSTS_MAX_AGE,
    `max-age>=${MIN_HSTS_MAX_AGE}`,
  );
  want("X-Content-Type-Options", (v) => v === "nosniff", "nosniff");
  want(
    "Referrer-Policy",
    (v) => v === "strict-origin-when-cross-origin",
    "strict-origin-when-cross-origin",
  );
  // A structured-field dictionary: a repeated feature takes its last value, as
  // in the browser, so `microphone=(), microphone=*` allows the microphone.
  const permissions = new Map(
    (h.get("permissions-policy") ?? "").split(",").map((entry) => {
      const [feature = "", ...value] = entry.trim().split("=");
      return [feature, value.join("=")];
    }),
  );
  const wanted = {
    camera: "()",
    microphone: "()",
    payment: "()",
    usb: "()",
    geolocation: geolocation ? "(self)" : "()",
  };
  for (const [feature, value] of Object.entries(wanted)) {
    want(
      "Permissions-Policy",
      () => permissions.get(feature) === value,
      `${feature}=${value}`,
    );
  }

  if (frame === "embeddable") {
    want("X-Frame-Options", (v) => v === "", "absent");
    want("Content-Security-Policy", (v) => v === "", "absent");
  } else {
    want("X-Frame-Options", (v) => v === "DENY", "DENY");
    want(
      "Content-Security-Policy",
      (v) => frameAncestors(v) === "'none'",
      "a first frame-ancestors directive of 'none'",
    );
  }
  return problems;
}
