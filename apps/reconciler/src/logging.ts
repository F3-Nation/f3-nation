/**
 * Structured JSON logging for Google Cloud Logging.
 *
 * This is an INTEROP CONTRACT with the F3R5_003 Terraform alert policies in
 * `infra/terraform/shared-platform/alert_policies.tf`. The log-based metrics
 * filter on these exact filter expressions:
 *
 *   resource.type="cloud_run_job"
 *   severity=CRITICAL
 *   jsonPayload.labels.redirect_platform_drift="true"
 *
 *   resource.type="cloud_run_job"
 *   severity=CRITICAL
 *   jsonPayload.labels.redirect_platform_stuck_operation="true"
 *
 *   resource.type="cloud_run_job"
 *   severity=CRITICAL
 *   jsonPayload.labels.redirect_platform_cert_renewal="true"
 *
 * So: severity MUST be the exact string "CRITICAL", and the label MUST live
 * at `jsonPayload.labels.<name>` with the string value "true". Cloud Logging
 * picks up a stdout JSON entry and promotes the top-level `severity` field
 * automatically; everything else we put in the top-level object shows up
 * under `jsonPayload` on the Cloud Logging entry. That means to land labels
 * at `jsonPayload.labels.*`, we emit them at `labels.*` on stdout.
 *
 * DO NOT rename, DO NOT change the value shape ("true" string, not boolean)
 * without coordinating with F3R5_003.
 */

export type LogSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type LogFields = Record<string, unknown>;

export interface LoggerContext {
  instanceId: string;
  region: string;
  /** Optional per-run id; index.ts sets this once per invocation. */
  runId?: string;
}

export interface DriftLogInput {
  domainId: string;
  driftKind: "spec_mismatch" | "orphan_resource" | "unexpected_state";
  resourceType: string;
  resourceName: string;
  observedSpec: unknown;
  expectedSpec: unknown;
  recoverableFrom: string | null;
}

export interface StuckOperationLogInput {
  operationName: string;
  lastLeaseExtendedAt: string;
  domainId?: string;
}

export interface CertRenewalLogInput {
  domainId: string;
  daysUntilExpiry: number;
  escalationLevel: "T-14" | "T-7" | "T-1";
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  critical(message: string, fields?: LogFields): void;
  drift(input: DriftLogInput): void;
  stuckOperation(input: StuckOperationLogInput): void;
  certRenewal(input: CertRenewalLogInput): void;
}

/**
 * Build a log entry in the shape Cloud Logging expects on stdout. Callers
 * get to inject an `emit` function so tests can capture entries instead of
 * writing to `console.log`.
 */
export interface CreateLoggerOptions {
  context: LoggerContext;
  emit?: (line: string) => void;
}

type Labels = Record<string, string>;

interface BaseEntry {
  severity: LogSeverity;
  message: string;
  reconciler_instance_id: string;
  reconciler_region: string;
  reconciler_run_id?: string;
  labels?: Labels;
  [key: string]: unknown;
}

function defaultEmit(line: string): void {
  // Cloud Logging automatically structures stdout JSON; no writer library
  // needed. Using console.log keeps the dependency footprint at zero.
  console.log(line);
}

function buildEntry(
  severity: LogSeverity,
  message: string,
  context: LoggerContext,
  extras: LogFields | undefined,
  labels: Labels | undefined,
): BaseEntry {
  const entry: BaseEntry = {
    severity,
    message,
    reconciler_instance_id: context.instanceId,
    reconciler_region: context.region,
  };
  if (context.runId !== undefined) {
    entry.reconciler_run_id = context.runId;
  }
  if (labels !== undefined) {
    entry.labels = labels;
  }
  if (extras !== undefined) {
    for (const [key, value] of Object.entries(extras)) {
      if (
        key === "severity" ||
        key === "message" ||
        key === "labels" ||
        key === "reconciler_instance_id" ||
        key === "reconciler_region" ||
        key === "reconciler_run_id"
      ) {
        // Reserved keys — ignore to preserve the contract.
        continue;
      }
      entry[key] = value;
    }
  }
  return entry;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { context } = options;
  const emit = options.emit ?? defaultEmit;

  function emitEntry(
    severity: LogSeverity,
    message: string,
    extras?: LogFields,
    labels?: Labels,
  ): void {
    const entry = buildEntry(severity, message, context, extras, labels);
    emit(JSON.stringify(entry));
  }

  return {
    info(message, fields) {
      emitEntry("INFO", message, fields);
    },
    warn(message, fields) {
      emitEntry("WARNING", message, fields);
    },
    error(message, fields) {
      emitEntry("ERROR", message, fields);
    },
    critical(message, fields) {
      emitEntry("CRITICAL", message, fields);
    },
    drift(input) {
      emitEntry(
        "CRITICAL",
        `reconciler drift detected: ${input.driftKind} on ${input.resourceType} ${input.resourceName}`,
        {
          domain_id: input.domainId,
          drift_kind: input.driftKind,
          resource_type: input.resourceType,
          resource_name: input.resourceName,
          observed_spec: input.observedSpec,
          expected_spec: input.expectedSpec,
          recoverable_from: input.recoverableFrom,
        },
        { redirect_platform_drift: "true", domain_id: input.domainId },
      );
    },
    stuckOperation(input) {
      emitEntry(
        "CRITICAL",
        `reconciler stuck operation: ${input.operationName} exceeded 30-minute heartbeat cap`,
        {
          operation_name: input.operationName,
          last_lease_extended_at: input.lastLeaseExtendedAt,
          ...(input.domainId !== undefined
            ? { domain_id: input.domainId }
            : {}),
        },
        {
          redirect_platform_stuck_operation: "true",
          ...(input.domainId !== undefined
            ? { domain_id: input.domainId }
            : {}),
        },
      );
    },
    certRenewal(input) {
      emitEntry(
        "CRITICAL",
        `reconciler cert renewal escalation ${input.escalationLevel} for ${input.domainId} (${input.daysUntilExpiry} days until expiry)`,
        {
          domain_id: input.domainId,
          days_until_expiry: input.daysUntilExpiry,
          escalation_level: input.escalationLevel,
        },
        {
          redirect_platform_cert_renewal: "true",
          domain_id: input.domainId,
          escalation_level: input.escalationLevel,
        },
      );
    },
  };
}
