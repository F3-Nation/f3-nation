import baseConfig from "@acme/eslint-config/base";
import vitestConfig from "@acme/vitest-config/eslint";

export default [...baseConfig, ...vitestConfig];
