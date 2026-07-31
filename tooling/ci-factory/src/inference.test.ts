import { describe, expect, it } from "vitest";

import type { InferenceConfig } from "./inference";
import {
  buildChatCompletionBody,
  getInferenceConfigFromEnv,
} from "./inference";

const FULL_ENV = {
  CI_FACTORY_INFERENCE_API_KEY: "test-key",
  CI_FACTORY_INFERENCE_BASE_URL: "https://api.anthropic.com/v1",
  CI_FACTORY_INFERENCE_MODEL: "claude-haiku-4-5-20251001",
};

describe("getInferenceConfigFromEnv", () => {
  it("returns config when all required vars are set", () => {
    const config = getInferenceConfigFromEnv({ ...FULL_ENV });

    expect(config).toEqual({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-haiku-4-5-20251001",
      jsonMode: false,
    });
  });

  it("throws naming every missing var when none are set", () => {
    expect(() => getInferenceConfigFromEnv({})).toThrow(
      /CI_FACTORY_INFERENCE_API_KEY, CI_FACTORY_INFERENCE_BASE_URL, CI_FACTORY_INFERENCE_MODEL/,
    );
  });

  it("throws naming only the missing var", () => {
    const env: Record<string, string | undefined> = { ...FULL_ENV };
    delete env.CI_FACTORY_INFERENCE_MODEL;

    expect(() => getInferenceConfigFromEnv(env)).toThrow(
      /Missing required inference env var\(s\): CI_FACTORY_INFERENCE_MODEL\./,
    );
  });

  it("does not silently default the base URL or model", () => {
    expect(() =>
      getInferenceConfigFromEnv({
        CI_FACTORY_INFERENCE_API_KEY: "test-key",
      }),
    ).toThrow(/no defaults/);
  });

  it("enables JSON mode only when CI_FACTORY_INFERENCE_JSON_MODE=1", () => {
    expect(
      getInferenceConfigFromEnv({
        ...FULL_ENV,
        CI_FACTORY_INFERENCE_JSON_MODE: "1",
      }).jsonMode,
    ).toBe(true);
    expect(
      getInferenceConfigFromEnv({
        ...FULL_ENV,
        CI_FACTORY_INFERENCE_JSON_MODE: "0",
      }).jsonMode,
    ).toBe(false);
    expect(getInferenceConfigFromEnv({ ...FULL_ENV }).jsonMode).toBe(false);
  });
});

describe("buildChatCompletionBody", () => {
  const config: InferenceConfig = {
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
    jsonMode: false,
  };

  it("omits response_format and temperature by default", () => {
    const body = buildChatCompletionBody({
      config,
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(body).not.toHaveProperty("response_format");
    // Top-tier models (Claude Opus 4.7+, gpt-5.x) reject sampling params —
    // temperature is opt-in per call, not a silent default.
    expect(body).not.toHaveProperty("temperature");
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ]);
  });

  it("includes temperature when explicitly requested", () => {
    const body = buildChatCompletionBody({
      config,
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0,
    });

    expect(body.temperature).toBe(0);
  });

  it("includes response_format when JSON mode is on", () => {
    const body = buildChatCompletionBody({
      config: { ...config, jsonMode: true },
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
