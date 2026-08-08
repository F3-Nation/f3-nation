import {
  HEALTH_CONTRACT_VERSION,
  healthResponseSchema,
} from "@f3nation/health";
import type {
  HealthFailureReason,
  HealthStatus,
  ContractStatusTarget,
  ExternalStatusTarget,
  StatusTarget,
  StatusResult,
} from "@f3nation/health";
import { z } from "zod";

import { logInfo, logWarn } from "../logger";
import { publicProcedure } from "../shared";
import { STATUS_TARGETS } from "./status-targets";

const STATUS_FETCH_TIMEOUT_MS = 5_000;
const STATUS_CACHE_TTL_MS = 60_000;

interface StatusCacheEntry {
  value: StatusResponse;
  expiresAt: number;
}

let statusCache: StatusCacheEntry | null = null;
let inFlightStatusRequest: Promise<StatusResponse> | null = null;

interface SlackCurrentStatusResponse {
  status: string;
  date_updated?: string;
  active_incidents?: unknown[];
}

interface StatusResponse {
  generatedAt: string;
  ttlSeconds: number;
  results: StatusResult[];
}

const STATUS_FAILURE_EVENT_BY_REASON: Record<
  HealthFailureReason,
  | "api.status.poll_unreachable"
  | "api.status.poll_invalid_json"
  | "api.status.poll_invalid_contract"
  | "api.status.poll_unsupported_contract_version"
  | "api.status.poll_invalid_monitor_config"
> = {
  unreachable: "api.status.poll_unreachable",
  invalid_json: "api.status.poll_invalid_json",
  invalid_contract: "api.status.poll_invalid_contract",
  unsupported_contract_version: "api.status.poll_unsupported_contract_version",
  invalid_monitor_config: "api.status.poll_invalid_monitor_config",
};

const externalSuccessSchema = z.object({
  ok: z.literal(true),
  source: z.literal("external"),
  status: z.enum(["ok", "degraded", "down"]),
  target: z.object({
    id: z.string(),
    label: z.string(),
    url: z.string().url(),
    source: z.literal("external"),
    provider: z.literal("slack"),
    apiUrl: z.string().url(),
  }),
  data: z.object({
    provider: z.literal("slack"),
    providerStatus: z.string(),
    timestamp: z.string(),
    incidents: z.number(),
  }),
});

const statusResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    source: z.literal("contract"),
    status: z.enum(["ok", "degraded", "down"]),
    target: z.object({
      id: z.string(),
      label: z.string(),
      url: z.string().url(),
      source: z.literal("contract"),
    }),
    data: healthResponseSchema,
  }),
  z.object({
    ok: z.literal(false),
    source: z.literal("contract"),
    status: z.literal("down"),
    target: z.object({
      id: z.string(),
      label: z.string(),
      url: z.string().url(),
      source: z.literal("contract"),
    }),
    reason: z.enum([
      "unreachable",
      "invalid_json",
      "invalid_contract",
      "unsupported_contract_version",
      "invalid_monitor_config",
    ]),
  }),
  externalSuccessSchema,
  z.object({
    ok: z.literal(false),
    source: z.literal("external"),
    status: z.literal("down"),
    target: z.object({
      id: z.string(),
      label: z.string(),
      url: z.string().url(),
      source: z.literal("external"),
      provider: z.literal("slack"),
      apiUrl: z.string().url(),
    }),
    reason: z.enum([
      "unreachable",
      "invalid_json",
      "invalid_contract",
      "unsupported_contract_version",
      "invalid_monitor_config",
    ]),
  }),
]);

const statusResponseSchema = z.object({
  generatedAt: z.string(),
  ttlSeconds: z.number(),
  results: z.array(statusResultSchema),
});

const CURRENT_HEALTH_CONTRACT_MAJOR = Number.parseInt(
  HEALTH_CONTRACT_VERSION.split(".")[0] ?? "1",
  10,
);

function parseContractMajor(contractVersion: string): number | null {
  const major = Number.parseInt(contractVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

function isSupportedContractMajor(
  serviceMajor: number | null,
  currentMajor: number,
): boolean {
  if (serviceMajor == null) return false;
  const supportedMajors = new Set([currentMajor]);
  if (currentMajor > 1) supportedMajors.add(currentMajor - 1);
  return supportedMajors.has(serviceMajor);
}

function parseContractStatusResponse(
  target: ContractStatusTarget,
  raw: unknown,
  currentContractMajor = CURRENT_HEALTH_CONTRACT_MAJOR,
): StatusResult {
  const parsed = healthResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "invalid_contract",
      details: {
        validationErrors: parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    };
  }

  const serviceMajor = parseContractMajor(parsed.data.contractVersion);
  if (!isSupportedContractMajor(serviceMajor, currentContractMajor)) {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "unsupported_contract_version",
      details: { serviceMajor, currentContractMajor },
    };
  }

  return {
    ok: true,
    source: "contract",
    target,
    status: parsed.data.status,
    data: parsed.data,
  };
}

async function fetchTextWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContractStatus(
  target: ContractStatusTarget,
  fetchImpl: typeof fetch = fetch,
  currentContractMajor = CURRENT_HEALTH_CONTRACT_MAJOR,
): Promise<StatusResult> {
  let fetchResult: { ok: boolean; status: number; text: string };

  try {
    fetchResult = await fetchTextWithTimeout(target.url, fetchImpl);
  } catch {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  if (!fetchResult.ok) {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fetchResult.text) as unknown;
  } catch {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "invalid_json",
    };
  }

  return parseContractStatusResponse(target, raw, currentContractMajor);
}

const SLACK_DOWN_STATUSES = new Set([
  "outage",
  "major_outage",
  "critical",
  "down",
]);
const SLACK_DEGRADED_STATUSES = new Set([
  "active",
  "degraded",
  "partial_outage",
  "minor_outage",
  "notice",
  "warning",
]);

function mapSlackStatus(status: string, incidents: number): HealthStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "ok") {
    return incidents > 0 ? "degraded" : "ok";
  }

  if (SLACK_DOWN_STATUSES.has(normalized)) {
    return "down";
  }

  if (SLACK_DEGRADED_STATUSES.has(normalized)) {
    return "degraded";
  }

  logWarn("api.status.poll_slack_unknown_status", {
    providerStatus: status,
    normalizedStatus: normalized,
    incidents,
  });
  return "degraded";
}

function parseSlackStatusResponse(
  target: ExternalStatusTarget,
  raw: unknown,
): StatusResult {
  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "invalid_json",
    };
  }

  const parsed = raw as SlackCurrentStatusResponse;
  if (typeof parsed.status !== "string") {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "invalid_json",
    };
  }

  const incidents = Array.isArray(parsed.active_incidents)
    ? parsed.active_incidents.length
    : 0;

  return {
    ok: true,
    source: "external",
    target,
    status: mapSlackStatus(parsed.status, incidents),
    data: {
      provider: "slack",
      providerStatus: parsed.status,
      timestamp: parsed.date_updated ?? new Date().toISOString(),
      incidents,
    },
  };
}

function hasValidExternalConfig(target: ExternalStatusTarget): boolean {
  if (!target.apiUrl || typeof target.apiUrl !== "string") {
    return false;
  }

  try {
    const parsed = new URL(target.apiUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchExternalStatus(
  target: ExternalStatusTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusResult> {
  if (!hasValidExternalConfig(target)) {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "invalid_monitor_config",
    };
  }

  let fetchResult: { ok: boolean; status: number; text: string };

  try {
    fetchResult = await fetchTextWithTimeout(target.apiUrl, fetchImpl);
  } catch {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  if (!fetchResult.ok) {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fetchResult.text) as unknown;
  } catch {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "invalid_json",
    };
  }

  if (target.provider === "slack") {
    return parseSlackStatusResponse(target, raw);
  }

  return {
    ok: false,
    source: "external",
    target,
    status: "down",
    reason: "invalid_monitor_config",
  };
}

async function fetchStatus(
  target: StatusTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusResult> {
  const result =
    target.source === "contract"
      ? await fetchContractStatus(target, fetchImpl)
      : await fetchExternalStatus(target, fetchImpl);

  if (result.ok) {
    logInfo("api.status.poll_success", {
      targetId: result.target.id,
      source: result.source,
      status: result.status,
      ...(result.source === "contract"
        ? { contractVersion: result.data.contractVersion }
        : { provider: result.data.provider }),
    });
    return result;
  }

  logWarn(STATUS_FAILURE_EVENT_BY_REASON[result.reason], {
    targetId: result.target.id,
    source: result.source,
    status: result.status,
    reason: result.reason,
    ...(result.details ? { details: result.details } : {}),
  });

  return result;
}

async function computeStatusSnapshot(
  fetchImpl: typeof fetch,
): Promise<StatusResponse> {
  const results = await Promise.all(
    STATUS_TARGETS.map((target) => fetchStatus(target, fetchImpl)),
  );

  return {
    generatedAt: new Date().toISOString(),
    ttlSeconds: STATUS_CACHE_TTL_MS / 1000,
    results,
  };
}

async function getCachedStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<StatusResponse> {
  const now = Date.now();
  if (statusCache && statusCache.expiresAt > now) {
    return statusCache.value;
  }

  if (inFlightStatusRequest) {
    return inFlightStatusRequest;
  }

  inFlightStatusRequest = computeStatusSnapshot(fetchImpl)
    .then((value) => {
      statusCache = {
        value,
        expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      inFlightStatusRequest = null;
    });

  return inFlightStatusRequest;
}

export function __resetStatusCacheForTests(): void {
  statusCache = null;
  inFlightStatusRequest = null;
}

export const statusRouter = publicProcedure
  .route({
    method: "GET",
    path: "/status",
    tags: ["status"],
    summary: "Aggregated status",
    description:
      "Returns aggregated status for contract and external monitors, cached for 60 seconds.",
  })
  .output(statusResponseSchema)
  .handler(async () => {
    return getCachedStatus();
  });
