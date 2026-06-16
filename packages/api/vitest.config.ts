import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    coverage: {
      provider: "v8",
      // Measure all of src; Vitest 4 otherwise only counts files a test imported.
      include: ["src/**/*.ts"],
    },
  },
});
