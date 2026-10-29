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
 * @param {NextConfigLike} config
 * @param {{ embeddable: boolean }} options
 *   `embeddable` is the map: intentionally iframed by third-party sites, so it
 *   must send no framing header and keeps `geolocation=(self)`.
 * @returns {Promise<string[]>}
 */
export async function nextSecurityHeaderProblems(config, { embeddable }) {
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
    (v) => /^max-age=\d+$/.test(v),
    "max-age=<n>",
  );
  want("X-Content-Type-Options", (v) => v === "nosniff", "nosniff");
  want(
    "Referrer-Policy",
    (v) => v === "strict-origin-when-cross-origin",
    "strict-origin-when-cross-origin",
  );
  want("Permissions-Policy", (v) => v.includes("camera=()"), "camera=()");

  if (embeddable) {
    want("X-Frame-Options", (v) => v === "", "absent");
    want("Content-Security-Policy", (v) => v === "", "absent");
    want(
      "Permissions-Policy",
      (v) => v.includes("geolocation=(self)"),
      "geolocation=(self)",
    );
  } else {
    want("X-Frame-Options", (v) => v === "DENY", "DENY");
    want(
      "Content-Security-Policy",
      (v) => v === "frame-ancestors 'none'",
      "frame-ancestors 'none'",
    );
    want(
      "Permissions-Policy",
      (v) => v.includes("geolocation=()"),
      "geolocation=()",
    );
  }
  return problems;
}
