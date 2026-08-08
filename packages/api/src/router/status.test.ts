import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const statusTargetsHolder = vi.hoisted(() => ({
  current: [
    {
      id: "me",
      label: "F3 Me",
      url: "http://localhost:3003/health",
      source: "contract" as const,
    },
    {
      id: "slack",
      label: "Slack",
      url: "https://status.slack.com",
      source: "external" as const,
      provider: "slack" as const,
      apiUrl: "https://slack-status.com/api/v2.0.0/current",
    },
  ],
}));

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../logger", () => ({
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

vi.mock("./status-targets", () => {
  const mod: Record<string, unknown> = {};
  Object.defineProperty(mod, "STATUS_TARGETS", {
    get() {
      return statusTargetsHolder.current;
    },
    enumerable: true,
  });
  return mod;
});

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
    statusTargetsHolder.current = [
      {
        id: "me",
        label: "F3 Me",
        url: "http://localhost:3003/health",
        source: "contract" as const,
      },
      {
        id: "slack",
        label: "Slack",
        url: "https://status.slack.com",
        source: "external" as const,
        provider: "slack" as const,
        apiUrl: "https://slack-status.com/api/v2.0.0/current",
      },
    ];
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
    expect(result.generatedAt).toBeTruthy();
    const resultIds = result.results.map((r) => r.target.id);
    expect(resultIds).toContain("me");
    expect(resultIds).toContain("slack");
    expect(result.results.every((r) => r.ok)).toBe(true);
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

  it("maps contract non-2xx response to unreachable even with valid-looking body", async () => {
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
                contractVersion: "1.0.0",
                status: "ok",
                timestamp: "2026-07-09T12:00:00.000Z",
                durationMs: 10,
                checks: [
                  { id: "f3-api-upstream", status: "ok", severity: "critical" },
                ],
              }),
              { status: 502 },
            ),
          );
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

  it("maps external non-2xx response to unreachable even with valid-looking body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);

        if (url.includes("/health")) {
          return Promise.resolve(buildContractOkResponse());
        }

        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", active_incidents: [] }), {
            status: 503,
          }),
        );
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

  it("maps external invalid_monitor_config and emits warning log", async () => {
    statusTargetsHolder.current = [
      {
        id: "bad-monitor",
        label: "Bad Monitor",
        url: "https://status.slack.com",
        source: "external" as const,
        provider: "slack" as const,
        // ftp:// passes z.string().url() but fails hasValidExternalConfig
        apiUrl: "ftp://not-http.example.com",
      },
    ];

    const client = createTestClient();
    const result = await client.status();
    const external = result.results.find(
      (entry) => entry.target.id === "bad-monitor",
    );

    expect(external).toMatchObject({
      ok: false,
      source: "external",
      status: "down",
      reason: "invalid_monitor_config",
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      "api.status.poll_invalid_monitor_config",
      expect.objectContaining({ targetId: "bad-monitor", source: "external" }),
    );
  });

  describe("cache and in-flight coalescing", () => {
    it("serves a cached response on second call without re-fetching", async () => {
      const client = createTestClient();
      const first = await client.status();
      const second = await client.status();

      expect(second.generatedAt).toBe(first.generatedAt);

      const fetchMock = vi.mocked(globalThis.fetch);
      const healthCalls = fetchMock.mock.calls.filter(([input]) =>
        getUrl(input).includes("/health"),
      );
      expect(healthCalls).toHaveLength(1);
    });

    it("re-fetches after the cache TTL has elapsed", async () => {
      vi.useFakeTimers();
      const client = createTestClient();

      await client.status();
      vi.advanceTimersByTime(61_000);
      await client.status();

      const fetchMock = vi.mocked(globalThis.fetch);
      const healthCalls = fetchMock.mock.calls.filter(([input]) =>
        getUrl(input).includes("/health"),
      );
      expect(healthCalls).toHaveLength(2);

      vi.useRealTimers();
    });

    it("coalesces concurrent requests into a single upstream fetch fan-out", async () => {
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = getUrl(input);
        if (url.includes("/health"))
          return Promise.resolve(buildContractOkResponse());
        return Promise.resolve(buildSlackOkResponse());
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = createTestClient();
      const p1 = client.status();
      const p2 = client.status();

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.generatedAt).toBe(r2.generatedAt);
      const healthCalls = fetchMock.mock.calls.filter(([input]) =>
        getUrl(input).includes("/health"),
      );
      expect(healthCalls).toHaveLength(1);
    });
  });
});
