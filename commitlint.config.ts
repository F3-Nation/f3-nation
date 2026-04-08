import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow longer subject lines for descriptive commits (1 = warn)
    "subject-max-length": [1, "always", 100],
    // Scope is optional but must be lowercase if present
    "scope-case": [2, "always", "lower-case"],
    // Subject must not end with a period
    "subject-full-stop": [2, "never", "."],
  },
};

export default config;
