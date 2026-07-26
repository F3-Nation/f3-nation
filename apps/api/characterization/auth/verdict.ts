import { expect } from "vitest";

/**
 * Auth guards run as oRPC middleware, BEFORE input validation and the handler.
 * So the auth *decision* is visible independently of what the handler does next:
 * an authorized request may still 400 (input validation) or 200. Only a 401
 * UNAUTHORIZED means the guard rejected the caller.
 *
 * These helpers assert the decision without coupling to the handler's fate.
 */

/**
 * Statuses that are never an auth pass. 404/405 mean the request never reached
 * the guard (route not registered, verb map diverged), 429 means the limiter
 * rejected it first, 403 is a role denial remapped to FORBIDDEN, and a 5xx
 * means middleware threw before auth resolved. As the Hono-port parity gate, this
 * suite must go red on all of them rather than read them as "authorized".
 */
const NOT_AUTHORIZED = [401, 403, 404, 405, 429];

/**
 * The guard let the caller through. Pass `allow` to opt a call site into a
 * documented post-auth failure, so a known fate is recorded rather than
 * absorbed along with every other one.
 */
export async function expectAuthorized(
  res: Response,
  opts: { allow?: number[] } = {},
): Promise<void> {
  const allowed = opts.allow ?? [];
  if (allowed.includes(res.status)) return;
  if (NOT_AUTHORIZED.includes(res.status) || res.status >= 500) {
    const body = await res.clone().text();
    expect.fail(`expected authorized, got ${res.status}: ${body}`);
  }
}

/** The guard rejected the caller. Optionally pin the exact message. */
export async function expectUnauthorized(
  res: Response,
  message?: string,
): Promise<void> {
  expect(res.status).toBe(401);
  // Not assumed to be JSON: the live and hono targets can surface a proxy's
  // HTML or plain-text 401, and a bare SyntaxError would hide the status.
  const raw = await res.clone().text();
  let body: { code?: string; message?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    expect.fail(
      `401 body was not JSON (${res.headers.get("content-type")}): ${raw.slice(0, 400)}`,
    );
  }
  expect(body.code).toBe("UNAUTHORIZED");
  if (message !== undefined) expect(body.message).toBe(message);
}
