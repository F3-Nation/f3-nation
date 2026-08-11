import type { Session } from "@acme/auth";
import { auth, getSessionFromHeaders } from "@acme/auth";
import { describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { withRequestHeaders } from "../header-store";
import { target } from "../transport";

/**
 * Transitional parity check for issue #646: `getSessionFromHeaders` must
 * resolve to the same session as the no-arg `auth()` it replaces in
 * packages/api/src/shared.ts, for every cookie shape the auth matrix cares
 * about. `auth()` only runs in-process here via the `next/headers` alias shim
 * (see next-headers-shim.ts), so this is gated the same way session.char.test.ts is.
 *
 * `expires` is compared with a tolerance rather than exact equality: @auth/core's
 * JWT session strategy recomputes it as `now + maxAge` on every read (a rolling
 * refresh, see @auth/core/lib/actions/session.js), so two independent calls a
 * few milliseconds apart never match byte-for-byte -- that's true of two calls
 * to `auth()` alone, not something this port introduces.
 */
function expectSameSession(a: Session | null, b: Session | null): void {
  if (a === null || b === null) {
    expect(a).toBe(b);
    return;
  }
  const { expires: aExpires, ...aRest } = a;
  const { expires: bExpires, ...bRest } = b;
  expect(aRest).toEqual(bRest);
  expect(
    Math.abs(new Date(aExpires).getTime() - new Date(bExpires).getTime()),
  ).toBeLessThan(5000);
}

describe.runIf(target.inProcess)(
  "getSessionFromHeaders parity with auth()",
  () => {
    const headersWith = (cookie?: string) =>
      new Headers({
        host: "api.characterization.test",
        ...(cookie ? { cookie } : {}),
      });

    it("matches auth() for a valid session cookie with roles", async () => {
      const roles = [
        { orgId: 1, orgName: "F3 Nation", roleName: "admin" as const },
      ];
      const cookie = await sessionCookie({ roles });
      const headers = headersWith(cookie);

      const viaAuth = await withRequestHeaders(headers, () => auth());
      const viaHeaders = await getSessionFromHeaders(headers);

      expectSameSession(viaHeaders, viaAuth);
      expect(viaHeaders?.roles).toEqual(roles);
    });

    it("matches auth() (both null) when no cookie is present", async () => {
      const headers = headersWith();

      const viaAuth = await withRequestHeaders(headers, () => auth());
      const viaHeaders = await getSessionFromHeaders(headers);

      expectSameSession(viaHeaders, viaAuth);
      expect(viaHeaders).toBeNull();
    });

    it("matches auth() (both null) for a tampered cookie", async () => {
      const cookie = (await sessionCookie()) + "tampered";
      const headers = headersWith(cookie);

      const viaAuth = await withRequestHeaders(headers, () => auth());
      const viaHeaders = await getSessionFromHeaders(headers);

      expectSameSession(viaHeaders, viaAuth);
      expect(viaHeaders).toBeNull();
    });

    it("matches auth() (both null) for an expired cookie", async () => {
      // encode() overwrites `exp` with now + maxAge, so an expired fixture needs
      // a negative maxAge (see fixtures/cookies.ts) rather than a stale exp claim.
      const cookie = await sessionCookie({ maxAge: -60 });
      const headers = headersWith(cookie);

      const viaAuth = await withRequestHeaders(headers, () => auth());
      const viaHeaders = await getSessionFromHeaders(headers);

      expectSameSession(viaHeaders, viaAuth);
      expect(viaHeaders).toBeNull();
    });
  },
);
