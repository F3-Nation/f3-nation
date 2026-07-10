import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../logger", () => ({
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

import { createTestClient } from "../__tests__/test-utils";
import { __resetStatusCacheForTests } from "./status";

function buildContractOkResponse() {
  return new Response(
    JSON.stringify({
      service: "f3-me",
      version: "test",
      contractVersion: "1.0.0",
      status: "ok",
      timestamp: "2026-07-09T12:00:00.000Z",
      durationMs: 10,
      checks: [
        {
          id: "f3-api-upstream",
          status: "ok",
          severity: "critical",
        },
      ],
    }),
    { status: 200 },
  );
}

function buildSlackOkResponse() {
  return new Response(
    JSON.stringify({
      status: "ok",
      date_updated: "2026-07-09T12:00:00.000Z",
      active_incidents: [],
    }),
    { status: 200 },
  );
}

function getUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

describe("Status Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStatusCacheForTests();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return buildContractOkResponse();
        }

        if (url.includes("slack-status.com/api/v2.0.0/current")) {
          return buildSlackOkResponse();
        }

        return new Response(JSON.stringify({ error: "unexpected url" }), {
          status: 404,
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns aggregated status payload", async () => {
    const client = createTestClient();

    const result = await client.status();

    expect(result.ttlSeconds).toBe(60);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.generatedAt).toBeTruthy();
    expect(mockLogInfo).toHaveBeenCalledWith(
      "api.status.poll_success",
      expect.objectContaining({ targetId: "me", source: "contract" }),
    );
  });

  it("maps contract fetch errors to unreachable and emits warning log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.reject(new Error("offline"));
        }

        return Promise.resolve(buildSlackOkResponse());
      }),
    );

    const client = createTestClient();
    const result = await client.status();
    const me = result.results.find((entry) => entry.target.id === "me");

    expect(me).toMatchObject({
      ok: false,
      source: "contract",
      status: "down",
      reason: "unreachable",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_unreachable",
      expect.objectContaining({ targetId: "me", source: "contract" }),
    );
  });

  it("maps contract invalid_json and emits warning log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(new Response("not json", { status: 200 }));
        }

        return Promise.resolve(buildSlackOkResponse());
      }),
    );

    const client = createTestClient();
    const result = await client.status();

    expect(
      result.results.find((entry) => entry.target.id === "me"),
    ).toMatchObject({
      reason: "invalid_json",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_invalid_json",
      expect.objectContaining({ targetId: "me", source: "contract" }),
    );
  });

  it("maps contract invalid_contract and emits warning log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(
            new Response(JSON.stringify({ nope: true }), { status: 200 }),
          );
        }

        return Promise.resolve(buildSlackOkResponse());
      }),
    );

    const client = createTestClient();
    const result = await client.status();

    expect(
      result.results.find((entry) => entry.target.id === "me"),
    ).toMatchObject({
      reason: "invalid_contract",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_invalid_contract",
      expect.objectContaining({ targetId: "me", source: "contract" }),
    );
  });

  it("maps unsupported contract major and logs unsupported version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                service: "f3-me",
                version: "test",
                contractVersion: "999.0.0",
                status: "ok",
                timestamp: "2026-07-09T12:00:00.000Z",
                durationMs: 10,
                checks: [
                  {
                    id: "f3-api-upstream",
                    status: "ok",
                    severity: "critical",
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(buildSlackOkResponse());
      }),
    );

    const client = createTestClient();
    const result = await client.status();
    const me = result.results.find((entry) => entry.target.id === "me");

    expect(me).toMatchObject({ reason: "unsupported_contract_version" });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_unsupported_contract_version",
      expect.objectContaining({ targetId: "me", source: "contract" }),
    );
  });

  it("maps external invalid_json and emits warning log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(buildContractOkResponse());
        }

        return Promise.resolve(new Response("not json", { status: 200 }));
      }),
    );

    const client = createTestClient();
    const result = await client.status();
    const external = result.results.find(
      (entry) => entry.target.id === "slack",
    );

    expect(external).toMatchObject({
      ok: false,
      source: "external",
      reason: "invalid_json",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_invalid_json",
      expect.objectContaining({ targetId: "slack", source: "external" }),
    );
  });

  it("maps external fetch errors to unreachable and emits warning log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(buildContractOkResponse());
        }

        return Promise.reject(new Error("network down"));
      }),
    );

    const client = createTestClient();
    const result = await client.status();
    const external = result.results.find(
      (entry) => entry.target.id === "slack",
    );

    expect(external).toMatchObject({
      ok: false,
      source: "external",
      status: "down",
      reason: "unreachable",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_unreachable",
      expect.objectContaining({ targetId: "slack", source: "external" }),
    );
  });
});
