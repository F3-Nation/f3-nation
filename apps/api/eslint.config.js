import baseConfig from "@acme/eslint-config/base";
import drizzleConfig from "@acme/eslint-config/drizzle";
import vitestConfig from "@acme/vitest-config/eslint";

export default [...baseConfig, ...drizzleConfig, ...vitestConfig];
