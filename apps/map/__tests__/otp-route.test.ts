/**
 * @vitest-environment node
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendVerificationRequest } = vi.hoisted(() => ({
  sendVerificationRequest: vi.fn<(params: unknown) => Promise<void>>(),
}));

vi.mock("~/env", () => ({
  env: {
    SUPER_ADMIN_API_KEY: "super-admin-key",
    F3_MAP_BASE_URL: "https://map.f3nation.test",
  },
}));

// Map has no direct @acme/env dependency; mock the provider's resolved module.
vi.mock("../../../packages/env/src/index", () => ({
  env: {
    EMAIL_FROM: "config@f3local.dev",
    EMAIL_SERVER: "smtp://config-host:1025",
  },
}));

vi.mock("~/app/api/otp/send-verification-request", () => ({
  sendVerificationRequest,
}));

const { POST } = await import("~/app/api/otp/route");

const post = (body: Record<string, unknown>) =>
  POST(
    new Request("https://map.f3nation.test/api/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

const validBody = {
  apiKey: "super-admin-key",
  identifier: "pax@f3local.dev",
  url: "https://map.f3nation.test/api/auth/callback/email?token=abc",
  token: "ABC123",
};

describe("POST /api/otp", () => {
  beforeEach(() => {
    sendVerificationRequest.mockReset();
    sendVerificationRequest.mockResolvedValue(undefined);
  });

  it("rejects a wrong api key with 401", async () => {
    const res = await post({ ...validBody, apiKey: "wrong-key" });
    expect(res.status).toBe(401);
    expect(sendVerificationRequest).not.toHaveBeenCalled();
  });

  it("rejects a missing api key with 401", async () => {
    const { apiKey: _apiKey, ...body } = validBody;
    const res = await post(body);
    expect(res.status).toBe(401);
  });

  it("rejects a url on a foreign origin with 400", async () => {
    const res = await post({
      ...validBody,
      url: "https://evil.example/api/auth/callback/email",
    });
    expect(res.status).toBe(400);
    expect(sendVerificationRequest).not.toHaveBeenCalled();
  });

  it("rejects an unparseable url with 400", async () => {
    const res = await post({ ...validBody, url: "not a url" });
    expect(res.status).toBe(400);
  });

  it("ignores server and from in the body and uses configured values", async () => {
    const res = await post({
      ...validBody,
      server: "smtp://attacker:25",
      from: "attacker@evil.example",
    });
    expect(res.status).toBe(200);
    expect(sendVerificationRequest).toHaveBeenCalledWith({
      identifier: validBody.identifier,
      url: validBody.url,
      server: "smtp://config-host:1025",
      from: "config@f3local.dev",
      token: validBody.token,
    });
  });
});
