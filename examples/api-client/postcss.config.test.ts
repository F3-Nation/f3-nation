import { describe, expect, it } from "vitest";

import postcssConfig from "./postcss.config.mjs";

describe("postcss config", () => {
  it("enables the Tailwind plugin", () => {
    expect(postcssConfig.plugins).toBeDefined();
    expect(postcssConfig.plugins["@tailwindcss/postcss"]).toEqual({});
  });
});
