// @ts-check
// Wiring check for a Next app's real config, shared by each app's
// `__tests__/next-config.test.ts`. The check runs in each app (not here) so
// that Turbo's affected-only CI reruns it whenever that app's config changes.
//
// Returns a list of problems instead of asserting, so this package stays free
// of a test-runner dependency and a test can `expect(problems).toEqual([])` to
// see every miss at once.

/**
 * @typedef {object} NextConfigLike
 * @property {boolean} [poweredByHeader]
 * @property {() => Promise<{ source: string; headers: { key: string; value: string }[] }[]>} [headers]
 */

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
  /** @type {Record<string, string | undefined>} */
  const h = Object.fromEntries(
    (rules[0]?.headers ?? []).map((x) => [x.key, x.value]),
  );

  /**
   * @param {string} key
   * @param {(value: string) => boolean} ok
   * @param {string} expected
   */
  const want = (key, ok, expected) => {
    if (!ok(h[key] ?? "")) {
      problems.push(`${key}: got ${JSON.stringify(h[key])}, want ${expected}`);
    }
  };
  want(
    "Strict-Transport-Security",
    (v) => /^max-age=\d+(;|$)/.test(v),
    "max-age=<n>",
  );
  want("X-Content-Type-Options", (v) => v === "nosniff", "nosniff");
  want(
    "Referrer-Policy",
    (v) => v === "strict-origin-when-cross-origin",
    "strict-origin-when-cross-origin",
  );
  want("Permissions-Policy", (v) => v.includes("camera=()"), "camera=()");

  const allowed = geolocation ? "geolocation=(self)" : "geolocation=()";
  want("Permissions-Policy", (v) => v.includes(allowed), allowed);

  if (frame === "embeddable") {
    want("X-Frame-Options", (v) => v === "", "absent");
    want("Content-Security-Policy", (v) => v === "", "absent");
  } else {
    want("X-Frame-Options", (v) => v === "DENY", "DENY");
    want(
      "Content-Security-Policy",
      (v) => v.split(";").some((d) => d.trim() === "frame-ancestors 'none'"),
      "a frame-ancestors 'none' directive",
    );
  }
  return problems;
}
