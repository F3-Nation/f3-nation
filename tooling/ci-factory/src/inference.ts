import { redactSecret } from "./redact";

export interface ChatCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
}

/** Per-request inference timeout. A full-size review over a large diff on a
 * top reasoning tier can run past two minutes (a 120KB diff measured ~3min end
 * to end), so the old 120s cap aborted legitimate reviews; a hung endpoint is
 * still bounded rather than stalling the whole CI job. */
const INFERENCE_TIMEOUT_MS = 300_000;

export interface InferenceConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** When true, request `response_format: { type: "json_object" }`. */
  jsonMode: boolean;
}

/**
 * Reads inference config from the environment. All three variables are
 * required — the model/endpoint choice is an explicit, reviewable decision
 * (F3-61 model tiering), never a silent default.
 */
export function getInferenceConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): InferenceConfig {
  const apiKey = env.CI_FACTORY_INFERENCE_API_KEY;
  const baseUrl = env.CI_FACTORY_INFERENCE_BASE_URL;
  const model = env.CI_FACTORY_INFERENCE_MODEL;

  if (!apiKey || !baseUrl || !model) {
    // Redact at the read site, not just at display time — a masked value
    // (never the secret itself) is all that ever exists in this array, so
    // there's no raw-key data flow into the thrown Error below to worry about.
    const missing = [
      ["CI_FACTORY_INFERENCE_API_KEY", redactSecret(apiKey)],
      ["CI_FACTORY_INFERENCE_BASE_URL", baseUrl],
      ["CI_FACTORY_INFERENCE_MODEL", model],
    ]
      .filter(([, value]) => !value || value === "(unset)")
      .map(([name]) => name)
      .join(", ");
    throw new Error(
      `Missing required inference env var(s): ${missing}. ` +
        "All of CI_FACTORY_INFERENCE_API_KEY, CI_FACTORY_INFERENCE_BASE_URL, " +
        "and CI_FACTORY_INFERENCE_MODEL must be set — there are no defaults. " +
        "Example (Anthropic OpenAI-compatible endpoint): " +
        'CI_FACTORY_INFERENCE_BASE_URL="https://api.anthropic.com/v1" ' +
        'CI_FACTORY_INFERENCE_MODEL="claude-haiku-4-5-20251001".',
    );
  }

  return {
    apiKey,
    baseUrl,
    model,
    jsonMode: env.CI_FACTORY_INFERENCE_JSON_MODE === "1",
  };
}

export function buildChatCompletionBody(args: {
  config: InferenceConfig;
  systemPrompt: string;
  userPrompt: string;
  /**
   * Omit for current top-tier models: sampling parameters are removed on
   * Claude Opus 4.7+ and OpenAI's gpt-5.x reasoning models — sending
   * `temperature` there is a 400. Cheap-tier classifiers (triage on Haiku)
   * still pass 0 for determinism.
   */
  temperature?: number;
}): Record<string, unknown> {
  return {
    model: args.config.model,
    ...(args.temperature !== undefined
      ? { temperature: args.temperature }
      : {}),
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userPrompt },
    ],
    // JSON mode is optional and off by default: the response parser is the
    // real guarantee, and some OpenAI-compatible endpoints reject
    // response_format (Anthropic's rejects json_object; it only accepts
    // json_schema).
    ...(args.config.jsonMode
      ? { response_format: { type: "json_object" } }
      : {}),
  };
}

export async function runChatCompletion(args: {
  config: InferenceConfig;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}): Promise<string> {
  const url = `${args.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Bound the request: a hung endpoint would otherwise stall the CI job until
  // the whole workflow times out. Abort covers the body read too, and the timer
  // is always cleared so it can't leak past a settled request.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatCompletionBody(args)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Inference request failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Inference response did not include message content");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}
