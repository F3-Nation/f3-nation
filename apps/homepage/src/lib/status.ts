import type { HealthResponse, HealthStatus } from "@f3nation/health";

// Type definitions used to shape the aggregated JSON payload received from
// GET /v1/status. All polling and aggregation logic lives server-side in
// packages/api/src/router/status.ts — no implementation code belongs here.

type HealthFailureReason =
  | "unreachable"
  | "invalid_json"
  | "invalid_contract"
  | "unsupported_contract_version"
  | "invalid_monitor_config";

type ExternalProvider = "slack";

interface ContractStatusTarget {
  id: string;
  label: string;
  url: string;
  source: "contract";
}

interface ExternalStatusTarget {
  id: string;
  label: string;
  url: string;
  source: "external";
  provider: ExternalProvider;
  apiUrl: string;
}

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
