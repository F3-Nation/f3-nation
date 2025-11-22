import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@acme/env": path.resolve(__dirname, "../../packages/env/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./__tests__/setup.ts"],
    server: {
      deps: {
        inline: ["next"],
      },
    },
  },
});
