import { encode } from "next-auth/jwt";

import type { OrgRole } from "@acme/shared/app/types";
import { COOKIE_NAME } from "@acme/shared/common/constants";

/**
 * The non-prod cookie prefix is empty (packages/auth/src/config.ts), and in
 * @auth/core the salt IS the cookie name.
 */
const SESSION_COOKIE_NAME = `${COOKIE_NAME}.session-token`;

export interface SessionCookieOptions {
  id?: string;
  email?: string;
  name?: string;
  roles?: OrgRole[];
  /**
   * encode() ALWAYS sets exp = now + maxAge, clobbering any exp in the token
   * payload. @auth/core's decode applies a 15s clockTolerance, so an expired
   * fixture needs a maxAge more negative than that — use -60, not -1.
   */
  maxAge?: number;
}

/** Build a `name=value` session cookie the real @auth/core decode accepts. */
export async function sessionCookie(
  opts: SessionCookieOptions = {},
): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for cookie fixtures");

  const token = await encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    ...(opts.maxAge === undefined ? {} : { maxAge: opts.maxAge }),
    token: {
      sub: opts.id ?? "1",
      id: opts.id ?? "1",
      email: opts.email ?? "char-cookie@example.com",
      name: opts.name ?? "Char Cookie User",
      roles: opts.roles ?? [],
    },
  });

  return `${SESSION_COOKIE_NAME}=${token}`;
}
