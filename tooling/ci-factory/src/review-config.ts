import type { InferenceConfig } from "./inference";
import { redactSecret } from "./redact";

/**
 * Per-role inference config for the F3-62 adversarial review chain.
 *
 * - reviewer-a: Anthropic credentials + a top-tier Claude model
 *   (CI_FACTORY_REVIEW_A_API_KEY / _BASE_URL / _MODEL).
 * - reviewer-b: independent OpenAI credentials + a top-tier OpenAI model
 *   (CI_FACTORY_REVIEW_B_API_KEY / _BASE_URL / _MODEL) — a genuinely
 *   different provider is the point of the adversarial design.
 * - judge: cheap tier (CI_FACTORY_JUDGE_MODEL) on reviewer A's credentials.
 *
 * Like getInferenceConfigFromEnv, every variable is required — model and
 * endpoint choices are explicit, reviewable decisions, never silent defaults.
 */
export type ReviewRole = "reviewer-a" | "reviewer-b" | "judge";

const ROLE_ENV_VARS: Record<
  ReviewRole,
  { apiKey: string; baseUrl: string; model: string }
> = {
  "reviewer-a": {
    apiKey: "CI_FACTORY_REVIEW_A_API_KEY",
    baseUrl: "CI_FACTORY_REVIEW_A_BASE_URL",
    model: "CI_FACTORY_REVIEW_A_MODEL",
  },
  "reviewer-b": {
    apiKey: "CI_FACTORY_REVIEW_B_API_KEY",
    baseUrl: "CI_FACTORY_REVIEW_B_BASE_URL",
    model: "CI_FACTORY_REVIEW_B_MODEL",
  },
  // The judge runs on reviewer A's (Anthropic) credentials with its own
  // cheap-tier model — merging/ranking is classification work (F3-61 tiering).
  judge: {
    apiKey: "CI_FACTORY_REVIEW_A_API_KEY",
    baseUrl: "CI_FACTORY_REVIEW_A_BASE_URL",
    model: "CI_FACTORY_JUDGE_MODEL",
  },
};

export function getReviewInferenceConfigFromEnv(
  role: ReviewRole,
  env: Record<string, string | undefined> = process.env,
): InferenceConfig {
  const names = ROLE_ENV_VARS[role];
  const apiKey = env[names.apiKey];
  const baseUrl = env[names.baseUrl];
  const model = env[names.model];

  if (!apiKey || !baseUrl || !model) {
    // Redact at the read site, not just at display time — a masked value
    // (never the secret itself) is all that ever exists in this array, so
    // there's no raw-key data flow into the thrown Error below to worry about.
    const missing = [
      [names.apiKey, redactSecret(apiKey)],
      [names.baseUrl, baseUrl],
      [names.model, model],
    ]
      .filter(([, value]) => !value || value === "(unset)")
      .map(([name]) => name)
      .join(", ");
    throw new Error(
      `Missing required inference env var(s) for review role "${role}": ${missing}. ` +
        `All of ${names.apiKey}, ${names.baseUrl}, and ${names.model} must be ` +
        "set — there are no defaults.",
    );
  }

  return {
    apiKey,
    baseUrl,
    model,
    // Off by default; the response parser is the real guarantee and
    // Anthropic's OpenAI-compatible endpoint rejects json_object.
    jsonMode: env.CI_FACTORY_INFERENCE_JSON_MODE === "1",
  };
}
