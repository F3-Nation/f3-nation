import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StatusResult } from "@f3nation/health";
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

function makeExternalResult(status: "ok" | "degraded" | "down"): StatusResult {
  return {
    ok: true,
    source: "external",
    target: {
      id: "slack",
      label: "Slack",
      url: "https://status.slack.com",
      source: "external",
      provider: "slack",
      apiUrl: "https://slack-status.com/api/v2.0.0/current",
    },
    status,
    data: {
      provider: "slack",
      providerStatus: status,
      incidents: status === "ok" ? 0 : 1,
      timestamp: "2026-07-09T12:00:00.000Z",
    },
  };
}

describe("status card rendering", () => {
  it("renders OK state with explicit status text", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusCard, { result: makeOkResult("ok") }),
    );

    expect(html).toContain("Status: OK");
    expect(html).toContain("Monitor: Contract");
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

  it("renders external monitor details and monitor source label", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusCard, {
        result: makeExternalResult("degraded"),
      }),
    );

    expect(html).toContain("Status: DEGRADED");
    expect(html).toContain("Monitor: External");
    expect(html).toContain("Provider:");
    expect(html).toContain("Provider status:");
    expect(html).toContain("Active incidents:");
  });

  it("renders external monitor failure with reason and source label", () => {
    const result: StatusResult = {
      ok: false,
      source: "external",
      target: {
        id: "slack",
        label: "Slack",
        url: "https://status.slack.com",
        source: "external",
        provider: "slack",
        apiUrl: "https://slack-status.com/api/v2.0.0/current",
      },
      status: "down",
      reason: "unreachable",
    };

    const html = renderToStaticMarkup(
      React.createElement(StatusCard, { result }),
    );

    expect(html).toContain("Status: DOWN");
    expect(html).toContain("Reason:");
    expect(html).toContain("unreachable");
    expect(html).toContain("Source:");
    expect(html).toContain("external");
  });
});
