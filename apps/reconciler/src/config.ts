/**
 * Environment variable loading for the reconciler Cloud Run job.
 *
 * See R5 Decision 8 for the `redirect_reconciler` Neon role this process
 * connects as. The connection string is provisioned via Secret Manager as
 * `neon-redirect-reconciler-url`.
 */

import { hostname as osHostname } from "node:os";
import { randomBytes } from "node:crypto";

export interface ReconcilerConfig {
  /** Neon connection string for the `redirect_reconciler` role. */
  databaseUrl: string;
  /** Unique per Cloud Run job task; passed into the singleton lease as `held_by`. */
  instanceId: string;
  /** GCP region this task is running in (`us-central1` | `europe-west1`). */
  region: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Synthesize a unique reconciler instance id.
 *
 * Cloud Run Jobs sets `CLOUD_RUN_EXECUTION` (execution name) and
 * `CLOUD_RUN_TASK_INDEX` (0-based index within the execution) on every task;
 * see https://cloud.google.com/run/docs/container-contract#env-vars. When
 * those are present we build a stable id from them plus a short random
 * suffix (so the same execution retrying a task still yields a unique
 * `held_by`). Otherwise we fall back to a local-dev shape.
 */
export function buildInstanceId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RECONCILER_INSTANCE_ID) {
    return env.RECONCILER_INSTANCE_ID;
  }
  const suffix = randomBytes(3).toString("hex");
  const execution = env.CLOUD_RUN_EXECUTION;
  const taskIndex = env.CLOUD_RUN_TASK_INDEX;
  const region = env.RECONCILER_REGION;
  if (execution && taskIndex !== undefined && region) {
    return `${region}-${execution}-task${taskIndex}-${suffix}`;
  }
  return `local-${osHostname()}-${suffix}`;
}

/**
 * Load + validate config. Throws `ConfigError` on missing required vars —
 * the caller (index.ts) is responsible for logging a CRITICAL entry and
 * exiting with code 1.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReconcilerConfig {
  const databaseUrl = env.REDIRECT_PLATFORM_DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError(
      "Missing required env var REDIRECT_PLATFORM_DATABASE_URL (Neon connection string for redirect_reconciler role)",
    );
  }
  const region = env.RECONCILER_REGION;
  if (!region) {
    throw new ConfigError(
      "Missing required env var RECONCILER_REGION (e.g. us-central1 or europe-west1)",
    );
  }
  return {
    databaseUrl,
    instanceId: buildInstanceId(env),
    region,
  };
}
