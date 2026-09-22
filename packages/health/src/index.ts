import { z } from "zod";

export const HEALTH_CONTRACT_VERSION = "1.0.0" as const;

export const healthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const healthSeveritySchema = z.enum(["critical", "warning", "info"]);

export const healthCheckSchema = z.object({
  id: z.string().min(1),
  status: healthStatusSchema,
  severity: healthSeveritySchema.default("warning"),
  latencyMs: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  contractVersion: z.string().min(1),
  status: healthStatusSchema,
  timestamp: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  checks: z.array(healthCheckSchema).min(1),
  notes: z.array(z.string()).optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type HealthSeverity = z.infer<typeof healthSeveritySchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Returned by a {@link CheckRunner}. All fields are included verbatim in the
 * public `/health` response body — never include secrets, PII, connection
 * strings, or internal stack details in `message` or `details`.
 */
export interface CheckRunnerResult {
  status: HealthStatus;
  severity?: HealthSeverity;
  message?: string;
  details?: Record<string, unknown>;
}

export type CheckRunner = () => CheckRunnerResult | Promise<CheckRunnerResult>;

export interface CheckSpec {
  id: string;
  run: CheckRunner;
  timeoutMs?: number;
  defaultSeverity?: HealthSeverity;
}

const DEFAULT_CHECK_TIMEOUT_MS = 1_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve({ timedOut: false, value });
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error ? error : new Error("Check execution failed"),
        );
      });
  });
}

export async function runChecks(specs: CheckSpec[]): Promise<HealthCheck[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const startedAt = Date.now();
      const timeoutMs = spec.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
      const fallbackSeverity = spec.defaultSeverity ?? "warning";

      try {
        const result = await withTimeout(
          Promise.resolve(spec.run()),
          timeoutMs,
        );

        if (result.timedOut) {
          return {
            id: spec.id,
            status: "down",
            severity: fallbackSeverity,
            latencyMs: Date.now() - startedAt,
            message: "Check timed out",
            details: {
              reason: "timeout",
              timeoutMs,
            },
          } satisfies HealthCheck;
        }

        return {
          id: spec.id,
          status: result.value.status,
          severity: result.value.severity ?? fallbackSeverity,
          latencyMs: Date.now() - startedAt,
          ...(result.value.message ? { message: result.value.message } : {}),
          ...(result.value.details ? { details: result.value.details } : {}),
        } satisfies HealthCheck;
      } catch {
        return {
          id: spec.id,
          status: "down",
          severity: fallbackSeverity,
          latencyMs: Date.now() - startedAt,
          message: "Check failed",
          details: {
            reason: "error",
          },
        } satisfies HealthCheck;
      }
    }),
  );
}

export function summarizeStatus(checks: HealthCheck[]): HealthStatus {
  const hasCriticalFailure = checks.some(
    (check) => check.status === "down" && check.severity === "critical",
  );
  if (hasCriticalFailure) return "down";

  const hasNonOk = checks.some((check) => check.status !== "ok");
  if (hasNonOk) return "degraded";

  return "ok";
}

export function buildHealthResponse(input: {
  service: string;
  version: string;
  checks: HealthCheck[];
  startedAt: number;
  notes?: string[];
}): HealthResponse {
  return {
    service: input.service,
    version: input.version,
    contractVersion: HEALTH_CONTRACT_VERSION,
    status: summarizeStatus(input.checks),
    timestamp: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedAt),
    checks: input.checks,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Status aggregation types
//
// Keeping them here ensures a single source of truth.
// ---------------------------------------------------------------------------

export type HealthFailureReason =
  | "unreachable"
  | "invalid_json"
  | "invalid_contract"
  | "unsupported_contract_version"
  | "invalid_monitor_config";

export type ExternalProvider = "slack";

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
  details?: Record<string, unknown>;
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
  details?: Record<string, unknown>;
}

export type StatusResult =
  | ContractStatusSuccess
  | ContractStatusFailure
  | ExternalStatusSuccess
  | ExternalStatusFailure;
