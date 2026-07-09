import {
  HEALTH_CONTRACT_VERSION,
  healthResponseSchema,
} from "@f3nation/health";
import type { HealthResponse, HealthStatus } from "@f3nation/health";

type HealthFailureReason =
  | "unreachable"
  | "invalid_json"
  | "invalid_contract"
  | "unsupported_contract_version";

export interface ContractStatusTarget {
  id: string;
  label: string;
  url: string;
  source: "contract";
}

export type StatusTarget = ContractStatusTarget;

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

export type StatusResult = ContractStatusSuccess | ContractStatusFailure;

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

export async function fetchContractStatus(
  target: ContractStatusTarget,
  fetchImpl: typeof fetch = fetch,
  currentContractMajor = CURRENT_HEALTH_CONTRACT_MAJOR,
): Promise<StatusResult> {
  let response: Response;

  try {
    response = await fetchImpl(target.url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
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
