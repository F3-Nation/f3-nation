import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StatusResult } from "@/lib/status";
import { StatusCard } from "@/app/status/status-card";

function makeOkResult(status: "ok" | "degraded"): StatusResult {
  return {
    ok: true,
    source: "contract",
    target: {
      id: "me",
      label: "F3 Me",
      url: "https://me.f3nation.test/health",
      source: "contract",
    },
    status,
    data: {
      service: "f3-me",
      version: "1.2.3+abc123",
      contractVersion: "1.0.0",
      status,
      timestamp: "2026-07-09T12:00:00.000Z",
      durationMs: 12,
      checks: [
        {
          id: "f3-api-upstream",
          status,
          severity: "critical",
          message: status === "degraded" ? "API latency elevated" : undefined,
        },
      ],
    },
  };
}

function makeDownResult(
  reason: "invalid_contract" | "unreachable",
): StatusResult {
  return {
    ok: false,
    source: "contract",
    target: {
      id: "me",
      label: "F3 Me",
      url: "https://me.f3nation.test/health",
      source: "contract",
    },
    status: "down",
    reason,
  };
}

describe("status card rendering", () => {
  it("renders OK state with explicit status text", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusCard, { result: makeOkResult("ok") }),
    );

    expect(html).toContain("Status: OK");
    expect(html).toContain("Contract version:");
    expect(html).toContain("Last updated:");
  });

  it("renders DEGRADED state with explicit status text", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusCard, { result: makeOkResult("degraded") }),
    );

    expect(html).toContain("Status: DEGRADED");
    expect(html).toContain("API latency elevated");
  });

  it("renders DOWN state and invalid_contract reason", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusCard, {
        result: makeDownResult("invalid_contract"),
      }),
    );

    expect(html).toContain("Status: DOWN");
    expect(html).toContain("Reason:");
    expect(html).toContain("invalid_contract");
  });
});
