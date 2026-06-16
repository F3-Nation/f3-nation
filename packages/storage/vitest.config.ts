import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Measure all of src; Vitest 4 otherwise only counts files a test imported.
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
