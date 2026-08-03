import { describe, expect, it } from "vitest";

import { getReviewInferenceConfigFromEnv } from "./review-config";

const FULL_ENV = {
  CI_FACTORY_REVIEW_A_API_KEY: "anthropic-key",
  CI_FACTORY_REVIEW_A_BASE_URL: "https://api.anthropic.com/v1",
  CI_FACTORY_REVIEW_A_MODEL: "claude-opus-4-8",
  CI_FACTORY_REVIEW_B_API_KEY: "openai-key",
  CI_FACTORY_REVIEW_B_BASE_URL: "https://api.openai.com/v1",
  CI_FACTORY_REVIEW_B_MODEL: "gpt-5.5",
  CI_FACTORY_JUDGE_MODEL: "claude-haiku-4-5-20251001",
};

describe("getReviewInferenceConfigFromEnv", () => {
  it("resolves reviewer A from the A credentials and model", () => {
    expect(
      getReviewInferenceConfigFromEnv("reviewer-a", { ...FULL_ENV }),
    ).toEqual({
      apiKey: "anthropic-key",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-opus-4-8",
      jsonMode: false,
    });
  });

  it("resolves reviewer B from the independent B credentials and model", () => {
    expect(
      getReviewInferenceConfigFromEnv("reviewer-b", { ...FULL_ENV }),
    ).toEqual({
      apiKey: "openai-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.5",
      jsonMode: false,
    });
  });

  it("resolves the judge on reviewer A's credentials with the cheap-tier model", () => {
    const config = getReviewInferenceConfigFromEnv("judge", { ...FULL_ENV });

    expect(config.apiKey).toBe("anthropic-key");
    expect(config.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(config.model).toBe("claude-haiku-4-5-20251001");
  });

  it("throws naming the exact missing vars for a role", () => {
    const env: Record<string, string | undefined> = { ...FULL_ENV };
    delete env.CI_FACTORY_REVIEW_B_API_KEY;
    delete env.CI_FACTORY_REVIEW_B_MODEL;

    expect(() => getReviewInferenceConfigFromEnv("reviewer-b", env)).toThrow(
      /reviewer-b.*CI_FACTORY_REVIEW_B_API_KEY, CI_FACTORY_REVIEW_B_MODEL/,
    );
    // Reviewer A remains resolvable — roles fail independently.
    expect(() =>
      getReviewInferenceConfigFromEnv("reviewer-a", env),
    ).not.toThrow();
  });

  it("throws for the judge when only the judge model is missing", () => {
    const env: Record<string, string | undefined> = { ...FULL_ENV };
    delete env.CI_FACTORY_JUDGE_MODEL;

    expect(() => getReviewInferenceConfigFromEnv("judge", env)).toThrow(
      /Missing required inference env var\(s\) for review role "judge": CI_FACTORY_JUDGE_MODEL\./,
    );
  });

  it("does not silently default any endpoint or model", () => {
    expect(() => getReviewInferenceConfigFromEnv("reviewer-a", {})).toThrow(
      /no defaults/,
    );
  });

  it("enables JSON mode only when CI_FACTORY_INFERENCE_JSON_MODE=1", () => {
    expect(
      getReviewInferenceConfigFromEnv("reviewer-a", {
        ...FULL_ENV,
        CI_FACTORY_INFERENCE_JSON_MODE: "1",
      }).jsonMode,
    ).toBe(true);
  });
});
