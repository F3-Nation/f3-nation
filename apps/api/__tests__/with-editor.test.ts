import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import type { JWT } from "next-auth/jwt";
import { getToken } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_PATHS } from "@acme/shared/app/constants";
import type { OrgRole } from "@acme/shared/app/types";

import withEditor from "../middleware/with-editor";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("~/env", () => ({ env: { AUTH_SECRET: "test-secret" } }));

const mockedGetToken = vi.mocked(getToken);

const EDITOR_PATH = EDITOR_PATHS[0] ?? "/regions";

// The JWT type declares roles as required, but tokens issued before the roles
// claim existed do not carry it — the cast lets tests cover that reality.
const buildToken = (roles?: OrgRole[]) =>
  ({ email: "pax@example.com", roles, signinunixsecondsepoch: 0 }) as JWT;

const buildRequest = (pathname: string, withSessionCookie = true) =>
  new NextRequest(`http://localhost${pathname}`, {
    headers: withSessionCookie
      ? { cookie: "authjs.session-token=some-token" }
      : {},
  });

const runMiddleware = (request: NextRequest) => {
  const next = vi.fn().mockResolvedValue(NextResponse.next());
  const handler = withEditor(next);
  return handler(request, {} as NextFetchEvent);
};

describe("withEditor middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through non-editor paths without checking the token", async () => {
    const res = await runMiddleware(buildRequest("/some-public-path"));

    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(res?.headers.get("location")).toBeNull();
  });

  it("redirects to sign-in when the session cookie is missing", async () => {
    const res = await runMiddleware(buildRequest(EDITOR_PATH, false));

    expect(res?.headers.get("location")).toContain("reason=no-cookie");
  });

  it("allows users with the editor role", async () => {
    mockedGetToken.mockResolvedValue(
      buildToken([{ orgId: 1, orgName: "F3 Test", roleName: "editor" }]),
    );

    const res = await runMiddleware(buildRequest(EDITOR_PATH));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("allows users with the admin role", async () => {
    mockedGetToken.mockResolvedValue(
      buildToken([{ orgId: 1, orgName: "F3 Test", roleName: "admin" }]),
    );

    const res = await runMiddleware(buildRequest(EDITOR_PATH));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("redirects users whose roles lack editor and admin", async () => {
    mockedGetToken.mockResolvedValue(
      buildToken([{ orgId: 1, orgName: "F3 Test", roleName: "user" }]),
    );

    const res = await runMiddleware(buildRequest(EDITOR_PATH));

    expect(res?.headers.get("location")).toContain("reason=not-editor");
  });

  it("redirects (not crashes) when the token has no roles claim", async () => {
    mockedGetToken.mockResolvedValue(buildToken());

    const res = await runMiddleware(buildRequest(EDITOR_PATH));

    expect(res?.headers.get("location")).toContain("reason=not-editor");
  });

  it("redirects when the token fails to decode", async () => {
    mockedGetToken.mockResolvedValue(null);

    const res = await runMiddleware(buildRequest(EDITOR_PATH));

    expect(res?.headers.get("location")).toContain("reason=not-editor");
  });
});
