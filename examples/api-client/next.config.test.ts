import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  it("exports a Next.js config object", () => {
    expect(nextConfig).toBeDefined();
    expect(typeof nextConfig).toBe("object");
  });
});
