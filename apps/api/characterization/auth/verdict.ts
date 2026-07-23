import { expect } from "vitest";

/**
 * Auth guards run as oRPC middleware, BEFORE input validation and the handler.
 * So the auth *decision* is visible independently of what the handler does next:
 * an authorized request may still 400 (input validation), 500 (handler side
 * effect, e.g. revalidate's next/cache call), or 200. Only a 401 UNAUTHORIZED
 * means the guard rejected the caller.
 *
 * These helpers assert the decision without coupling to the handler's fate.
 */

/** The guard let the caller through (any non-401 outcome). */
export async function expectAuthorized(res: Response): Promise<void> {
  if (res.status === 401) {
    const body = await res.clone().text();
    expect.fail(`expected authorized, got 401: ${body}`);
  }
  expect(res.status).not.toBe(401);
}

/** The guard rejected the caller. Optionally pin the exact message. */
export async function expectUnauthorized(
  res: Response,
  message?: string,
): Promise<void> {
  expect(res.status).toBe(401);
  const body = (await res.clone().json()) as { code: string; message: string };
  expect(body.code).toBe("UNAUTHORIZED");
  if (message !== undefined) expect(body.message).toBe(message);
}
