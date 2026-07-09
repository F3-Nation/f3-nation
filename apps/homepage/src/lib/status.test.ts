import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_HEALTH_CONTRACT_MAJOR,
  fetchContractStatus,
  parseContractStatusResponse,
} from "@/lib/status";
import type { ContractStatusTarget } from "@/lib/status";

const target: ContractStatusTarget = {
  id: "me",
  label: "F3 Me",
  url: "https://me.f3nation.test/health",
  source: "contract",
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
    if (result.ok) {
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
    if (result.ok) {
      expect(result.status).toBe("degraded");
      expect(result.data.status).toBe("degraded");
    }
  });
});
