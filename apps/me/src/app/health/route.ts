import { NextResponse } from "next/server";
import { buildHealthResponse, runChecks } from "@f3nation/health";
import type { CheckRunnerResult } from "@f3nation/health";
import { logError } from "@/lib/logging";

const SERVICE_NAME = "f3-me";
const CHECK_ID = "f3-api-upstream";
const CHECK_TIMEOUT_MS = 1_500;

function getServiceVersion(): string {
  return process.env.NODE_ENV === "production" ? "production" : "dev";
}

async function checkUpstreamApi(): Promise<CheckRunnerResult> {
  const apiBaseUrl = process.env.F3_API_BASE_URL;

  if (!apiBaseUrl) {
    return {
      status: "down",
      message: "F3_API_BASE_URL is not configured",
      details: { reason: "missing_config" },
    };
  }

  try {
    const normalizedBaseUrl = apiBaseUrl.endsWith("/")
      ? apiBaseUrl
      : `${apiBaseUrl}/`;
    const url = new URL("ping", normalizedBaseUrl).toString();
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });

    if (response.ok) {
      return {
        status: "ok",
      };
    }

    return {
      status: response.status >= 500 ? "down" : "degraded",
      message: `Upstream API returned HTTP ${response.status}`,
      details: {
        reason: "upstream_http_error",
        status: response.status,
      },
    };
  } catch {
    return {
      status: "down",
      message: "Upstream API is unreachable",
      details: { reason: "unreachable" },
    };
  }
}

export async function GET() {
  const startedAt = Date.now();

  try {
    const checks = await runChecks([
      {
        id: CHECK_ID,
        timeoutMs: CHECK_TIMEOUT_MS,
        defaultSeverity: "critical",
        run: checkUpstreamApi,
      },
    ]);

    const payload = buildHealthResponse({
      service: SERVICE_NAME,
      version: getServiceVersion(),
      checks,
      startedAt,
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError(
      "me.health.endpoint_failed",
      { hasApiBaseUrl: Boolean(process.env.F3_API_BASE_URL) },
      err,
    );

    const payload = buildHealthResponse({
      service: SERVICE_NAME,
      version: getServiceVersion(),
      startedAt,
      checks: [
        {
          id: "health-endpoint",
          status: "down",
          severity: "critical",
          message: "Health endpoint failed",
          details: { reason: "internal_error" },
        },
      ],
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
