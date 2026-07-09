import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_HEALTH_CONTRACT_MAJOR,
  fetchExternalStatus,
  fetchStatus,
  fetchContractStatus,
  parseContractStatusResponse,
} from "@/lib/status";
import type { ContractStatusTarget, ExternalStatusTarget } from "@/lib/status";

const target: ContractStatusTarget = {
  id: "me",
  label: "F3 Me",
  url: "https://me.f3nation.test/health",
  source: "contract",
};

const slackTarget: ExternalStatusTarget = {
  id: "slack",
  label: "Slack",
  url: "https://status.slack.com",
  source: "external",
  provider: "slack",
  apiUrl: "https://slack-status.com/api/v2.0.0/current",
};

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    service: "f3-me",
    version: "1.2.3+abc123",
    contractVersion: "1.0.0",
    status: "ok",
    timestamp: "2026-07-09T12:00:00.000Z",
    durationMs: 12,
    checks: [
      {
        id: "f3-api-upstream",
        status: "ok",
        severity: "critical",
      },
    ],
    ...overrides,
  };
}

describe("homepage status ingestion", () => {
  it("maps network failures to unreachable", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as typeof fetch;

    const result = await fetchContractStatus(target, fetchImpl);

    expect(result).toMatchObject({
      ok: false,
      status: "down",
      reason: "unreachable",
    });
  });

  it("maps contract timeout aborts to unreachable", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    const resultPromise = fetchContractStatus(target, fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      status: "down",
      reason: "unreachable",
    });
    vi.useRealTimers();
  });

  it("maps malformed JSON to invalid_json", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("not json", { status: 200 }),
      ) as typeof fetch;

    const result = await fetchContractStatus(target, fetchImpl);

    expect(result).toMatchObject({
      ok: false,
      status: "down",
      reason: "invalid_json",
    });
  });

  it("maps schema mismatches to invalid_contract", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ nope: true }), { status: 200 }),
      ) as typeof fetch;

    const result = await fetchContractStatus(target, fetchImpl);

    expect(result).toMatchObject({
      ok: false,
      status: "down",
      reason: "invalid_contract",
    });
  });

  it("maps unsupported contract majors to unsupported_contract_version", () => {
    const result = parseContractStatusResponse(
      target,
      makePayload({ contractVersion: "3.0.0" }),
      2,
    );

    expect(result).toMatchObject({
      ok: false,
      status: "down",
      reason: "unsupported_contract_version",
    });
  });

  it("supports N and N-1 contract majors", () => {
    const result = parseContractStatusResponse(
      target,
      makePayload({ contractVersion: "1.9.0", status: "degraded" }),
      2,
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.source === "contract") {
      expect(result.status).toBe("degraded");
      expect(result.data.contractVersion).toBe("1.9.0");
    }
  });

  it("treats body status as source of truth for valid responses", async () => {
    const payload = makePayload({ status: "degraded" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 503 }),
      ) as typeof fetch;

    const result = await fetchContractStatus(
      target,
      fetchImpl,
      CURRENT_HEALTH_CONTRACT_MAJOR,
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.source === "contract") {
      expect(result.status).toBe("degraded");
      expect(result.data.status).toBe("degraded");
    }
  });

  it("maps Slack external monitor payload to shared status model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          date_updated: "2026-07-09T12:00:00.000Z",
          active_incidents: [{ id: "INC-1" }],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await fetchExternalStatus(slackTarget, fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("external");
    expect(result.status).toBe("degraded");
  });

  it("maps external timeout aborts to unreachable", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    const resultPromise = fetchExternalStatus(slackTarget, fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      source: "external",
      status: "down",
      reason: "unreachable",
    });
    vi.useRealTimers();
  });

  it("maps invalid external monitor config to invalid_monitor_config", async () => {
    const invalidTarget: ExternalStatusTarget = {
      ...slackTarget,
      apiUrl: "",
    };

    const result = await fetchExternalStatus(invalidTarget);

    expect(result).toMatchObject({
      ok: false,
      source: "external",
      status: "down",
      reason: "invalid_monitor_config",
    });
  });

  it("dispatches through fetchStatus for external targets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "outage",
          date_updated: "2026-07-09T12:00:00.000Z",
          active_incidents: [],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await fetchStatus(slackTarget, fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("down");
    expect(result.source).toBe("external");
  });
});
