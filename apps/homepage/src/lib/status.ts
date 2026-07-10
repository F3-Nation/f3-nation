import {
  HEALTH_CONTRACT_VERSION,
  healthResponseSchema,
} from "@f3nation/health";
import type { HealthResponse, HealthStatus } from "@f3nation/health";

type HealthFailureReason =
  | "unreachable"
  | "invalid_json"
  | "invalid_contract"
  | "unsupported_contract_version"
  | "invalid_monitor_config";

type ExternalProvider = "slack";
const STATUS_FETCH_TIMEOUT_MS = 5_000;

interface SlackCurrentStatusResponse {
  status: string;
  date_updated?: string;
  active_incidents?: unknown[];
}

export interface ContractStatusTarget {
  id: string;
  label: string;
  url: string;
  source: "contract";
}

export interface ExternalStatusTarget {
  id: string;
  label: string;
  url: string;
  source: "external";
  provider: ExternalProvider;
  apiUrl: string;
}

export type StatusTarget = ContractStatusTarget | ExternalStatusTarget;

interface ContractStatusSuccess {
  ok: true;
  target: ContractStatusTarget;
  source: "contract";
  status: HealthStatus;
  data: HealthResponse;
}

interface ContractStatusFailure {
  ok: false;
  target: ContractStatusTarget;
  source: "contract";
  status: "down";
  reason: HealthFailureReason;
}

interface ExternalStatusSuccess {
  ok: true;
  target: ExternalStatusTarget;
  source: "external";
  status: HealthStatus;
  data: {
    provider: ExternalProvider;
    providerStatus: string;
    timestamp: string;
    incidents: number;
  };
}

interface ExternalStatusFailure {
  ok: false;
  target: ExternalStatusTarget;
  source: "external";
  status: "down";
  reason: HealthFailureReason;
}

export type StatusResult =
  | ContractStatusSuccess
  | ContractStatusFailure
  | ExternalStatusSuccess
  | ExternalStatusFailure;

export const CURRENT_HEALTH_CONTRACT_MAJOR = Number.parseInt(
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

export function parseContractStatusResponse(
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

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchContractStatus(
  target: ContractStatusTarget,
  fetchImpl: typeof fetch = fetch,
  currentContractMajor = CURRENT_HEALTH_CONTRACT_MAJOR,
): Promise<StatusResult> {
  let response: Response;

  try {
    response = await fetchWithTimeout(target.url, fetchImpl);
  } catch {
    return {
      ok: false,
      source: "contract",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  const bodyText = await response.text();

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
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

function mapSlackStatus(status: string, incidents: number): HealthStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "ok") {
    return incidents > 0 ? "degraded" : "ok";
  }

  if (["outage", "major_outage", "critical", "down"].includes(normalized)) {
    return "down";
  }

  if (
    [
      "active",
      "degraded",
      "partial_outage",
      "minor_outage",
      "notice",
      "warning",
    ].includes(normalized)
  ) {
    return "degraded";
  }

  return incidents > 0 ? "degraded" : "ok";
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

export async function fetchExternalStatus(
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

  let response: Response;

  try {
    response = await fetchWithTimeout(target.apiUrl, fetchImpl);
  } catch {
    return {
      ok: false,
      source: "external",
      target,
      status: "down",
      reason: "unreachable",
    };
  }

  const bodyText = await response.text();

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
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

export async function fetchStatus(
  target: StatusTarget,
  fetchImpl: typeof fetch = fetch,
  currentContractMajor = CURRENT_HEALTH_CONTRACT_MAJOR,
): Promise<StatusResult> {
  if (target.source === "contract") {
    return fetchContractStatus(target, fetchImpl, currentContractMajor);
  }

  return fetchExternalStatus(target, fetchImpl);
}
